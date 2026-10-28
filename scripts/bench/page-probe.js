// Page-side probe for `npm run bench` (scripts/bench/bench.mjs). Injected with
// Playwright's addInitScript, so it runs before the app creates its WebGL
// context. Plain script, no imports: it is evaluated as page source.
//
// What it measures:
// - frame times: requestAnimationFrame timestamp deltas while recording;
// - GPU ms per pass: EXT_disjoint_timer_query_webgl2 TIME_ELAPSED queries.
//   Queries cannot nest, so the frame is cut into segments: a new one starts
//   at every draw-framebuffer bind and around every blitFramebuffer, and
//   each segment is labelled by its target (canvas / fbN) and the last
//   viewport set inside it. A frame starts at this probe's rAF callback,
//   which runs before R3F's (it is requested first, every frame);
// - GPU memory: every texture, renderbuffer and buffer allocation is tallied
//   from its sized format (compressed uploads by their byte length), plus
//   the canvas drawing buffer. An estimate of what the driver must hold, not
//   a driver readout; padding and driver-internal copies are not visible.
;(() => {
  if (window.__bench) return

  const GL = WebGL2RenderingContext
  // The app can create more than one WebGL2 context (capability probes), so
  // GPU results are kept per context and collect() reports the one that
  // draws the most: the scene canvas. Frame times come from one global loop.
  const state = {
    recording: false,
    frameStamps: [],
    contexts: [],
  }

  // ─── Byte sizes per sized internal format ──────────────────────────────────
  const BPP = new Map([
    [GL.R8, 1], [GL.R8_SNORM, 1], [GL.R8UI, 1], [GL.R8I, 1],
    [GL.RG8, 2], [GL.R16F, 2], [GL.R16UI, 2], [GL.R16I, 2], [GL.RGB565, 2], [GL.RGBA4, 2], [GL.RGB5_A1, 2],
    [GL.RGB8, 3], [GL.SRGB8, 3], [GL.RGB8_SNORM, 3],
    [GL.RGBA8, 4], [GL.SRGB8_ALPHA8, 4], [GL.RGBA8_SNORM, 4], [GL.RGB10_A2, 4], [GL.R11F_G11F_B10F, 4],
    [GL.RG16F, 4], [GL.R32F, 4], [GL.RGB9_E5, 4], [GL.RGBA8UI, 4], [GL.R32UI, 4],
    [GL.RGB16F, 6], [GL.RGBA16F, 8], [GL.RG32F, 8], [GL.RGB32F, 12], [GL.RGBA32F, 16],
    [GL.DEPTH_COMPONENT16, 2], [GL.DEPTH_COMPONENT24, 4], [GL.DEPTH_COMPONENT32F, 4],
    [GL.DEPTH24_STENCIL8, 4], [GL.DEPTH32F_STENCIL8, 8], [GL.STENCIL_INDEX8, 1],
  ])
  // Compressed formats: bytes per 4×4 block (enum values from the WebGL
  // compressed-texture extensions).
  const BLOCK_BYTES = new Map([
    [0x83f0, 8], [0x83f1, 8], [0x8c4c, 8], [0x8c4d, 8], // BC1 (S3TC DXT1, + sRGB)
    [0x83f2, 16], [0x83f3, 16], [0x8c4e, 16], [0x8c4f, 16], // BC2/BC3
    [0x8e8c, 16], [0x8e8d, 16], [0x8e8e, 16], [0x8e8f, 16], // BC7 / BC6H (BPTC)
    [0x9274, 8], [0x9275, 8], [0x9276, 8], [0x9277, 8], [0x9278, 16], [0x9279, 16], // ETC2
    [0x8d64, 8], // ETC1
    [0x93b0, 16], [0x93d0, 16], // ASTC 4×4 (+ sRGB)
    [0x8dbb, 8], [0x8dbc, 8], [0x8dbd, 16], [0x8dbe, 16], // RGTC
  ])
  const unsizedBpp = (format, type) => {
    const channels = { [GL.RGBA]: 4, [GL.RGB]: 3, [GL.RG]: 2, [GL.RED]: 1, [GL.ALPHA]: 1, [GL.LUMINANCE]: 1, [GL.LUMINANCE_ALPHA]: 2 }[format] ?? 4
    const bytes = type === GL.FLOAT ? 4 : type === GL.HALF_FLOAT ? 2 : 1
    return channels * bytes
  }
  const levelBytes = (internalformat, width, height, format, type) => {
    const block = BLOCK_BYTES.get(internalformat)
    if (block) return Math.ceil(width / 4) * Math.ceil(height / 4) * block
    return width * height * (BPP.get(internalformat) ?? unsizedBpp(format ?? internalformat, type))
  }
  const isCubeFace = (target) => target >= GL.TEXTURE_CUBE_MAP_POSITIVE_X && target <= GL.TEXTURE_CUBE_MAP_NEGATIVE_Z
  const bindingTarget = (target) => (isCubeFace(target) ? GL.TEXTURE_CUBE_MAP : target)

  const textures = new Map() // WebGLTexture -> { levels: Map<key, bytes>, w, h, format, immutable }
  const renderbuffers = new Map() // WebGLRenderbuffer -> bytes
  const buffers = new Map() // WebGLBuffer -> bytes
  let drawingBuffer = 0

  function instrument(gl, contextAttributes) {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
    const ctx = { timerSupported: !!ext, gpuFrames: [], disjointFrames: 0, totalDraws: 0 }
    state.contexts.push(ctx)
    const samples = contextAttributes?.antialias === false ? 1 : 4
    drawingBuffer = () => gl.drawingBufferWidth * gl.drawingBufferHeight * (4 + 4) * samples

    // ─── Binding state (for allocation attribution) ──────────────────────────
    let activeUnit = 0
    const units = new Map() // unit -> Map<target, texture>
    const boundTexture = (target) => units.get(activeUnit)?.get(bindingTarget(target)) ?? null
    const bufferBindings = new Map()
    let currentVao = null
    const vaoElements = new Map()
    let boundRenderbuffer = null

    const wrap = (name, fn) => {
      const original = gl[name]
      if (typeof original !== 'function') return
      gl[name] = function (...args) { return fn.call(this, original.bind(gl), args) }
    }

    wrap('activeTexture', (orig, [unit]) => { activeUnit = unit - GL.TEXTURE0; return orig(unit) })
    wrap('bindTexture', (orig, [target, texture]) => {
      if (!units.has(activeUnit)) units.set(activeUnit, new Map())
      units.get(activeUnit).set(target, texture)
      return orig(target, texture)
    })
    wrap('deleteTexture', (orig, [texture]) => { textures.delete(texture); return orig(texture) })
    const record = (target, key, bytes, w, h, format, immutable = false) => {
      const texture = boundTexture(target)
      if (!texture) return
      let entry = textures.get(texture)
      if (!entry || immutable) {
        entry = { levels: new Map(), w, h, format, immutable }
        textures.set(texture, entry)
      }
      if (key === 0 || key === '0:0') { entry.w = w; entry.h = h; entry.format = format }
      entry.levels.set(key, bytes)
    }
    const faceKey = (target, level) => (isCubeFace(target) ? `${target - GL.TEXTURE_CUBE_MAP_POSITIVE_X}:${level}` : level)
    wrap('texStorage2D', (orig, [target, levels, internalformat, width, height]) => {
      const faces = target === GL.TEXTURE_CUBE_MAP ? 6 : 1
      let bytes = 0
      for (let l = 0; l < levels; l++) bytes += levelBytes(internalformat, Math.max(1, width >> l), Math.max(1, height >> l)) * faces
      record(target, 'storage', bytes, width, height, internalformat, true)
      return orig(target, levels, internalformat, width, height)
    })
    wrap('texStorage3D', (orig, [target, levels, internalformat, width, height, depth]) => {
      let bytes = 0
      for (let l = 0; l < levels; l++) bytes += levelBytes(internalformat, Math.max(1, width >> l), Math.max(1, height >> l)) * depth
      record(target, 'storage', bytes, width, height, internalformat, true)
      return orig(target, levels, internalformat, width, height, depth)
    })
    wrap('texImage2D', (orig, args) => {
      const [target, level, internalformat] = args
      let width, height, format, type
      if (args.length >= 8) {
        ;[, , , width, height, , format, type] = args
      } else {
        const source = args[5]
        format = args[3]
        type = args[4]
        width = source?.naturalWidth || source?.videoWidth || source?.displayWidth || source?.width || 0
        height = source?.naturalHeight || source?.videoHeight || source?.displayHeight || source?.height || 0
      }
      record(target, faceKey(target, level), levelBytes(internalformat, width, height, format, type), width, height, internalformat)
      return orig(...args)
    })
    wrap('compressedTexImage2D', (orig, args) => {
      const [target, level, internalformat, width, height, , data] = args
      const bytes = data?.byteLength ?? levelBytes(internalformat, width, height)
      record(target, faceKey(target, level), bytes, width, height, internalformat)
      return orig(...args)
    })
    wrap('generateMipmap', (orig, [target]) => {
      const texture = boundTexture(target)
      const entry = texture && textures.get(texture)
      if (entry && !entry.immutable) {
        const faces = target === GL.TEXTURE_CUBE_MAP ? 6 : 1
        const base = (entry.levels.get(0) ?? entry.levels.get('0:0') ?? 0)
        // Each mip level is a quarter of the one above: the chain adds 1/3.
        entry.levels.set('mips', (base * faces) / 3)
      }
      return orig(target)
    })

    wrap('bindRenderbuffer', (orig, [target, rb]) => { boundRenderbuffer = rb; return orig(target, rb) })
    wrap('deleteRenderbuffer', (orig, [rb]) => { renderbuffers.delete(rb); return orig(rb) })
    wrap('renderbufferStorage', (orig, [target, internalformat, width, height]) => {
      if (boundRenderbuffer) renderbuffers.set(boundRenderbuffer, levelBytes(internalformat, width, height))
      return orig(target, internalformat, width, height)
    })
    wrap('renderbufferStorageMultisample', (orig, [target, samplesN, internalformat, width, height]) => {
      if (boundRenderbuffer) renderbuffers.set(boundRenderbuffer, levelBytes(internalformat, width, height) * Math.max(1, samplesN))
      return orig(target, samplesN, internalformat, width, height)
    })

    wrap('bindVertexArray', (orig, [vao]) => {
      currentVao = vao
      bufferBindings.set(GL.ELEMENT_ARRAY_BUFFER, vaoElements.get(vao) ?? null)
      return orig(vao)
    })
    wrap('bindBuffer', (orig, [target, buffer]) => {
      bufferBindings.set(target, buffer)
      if (target === GL.ELEMENT_ARRAY_BUFFER) vaoElements.set(currentVao, buffer)
      return orig(target, buffer)
    })
    wrap('deleteBuffer', (orig, [buffer]) => { buffers.delete(buffer); return orig(buffer) })
    wrap('bufferData', (orig, args) => {
      const [target, sizeOrData] = args
      const buffer = bufferBindings.get(target)
      if (buffer) buffers.set(buffer, typeof sizeOrData === 'number' ? sizeOrData : (sizeOrData?.byteLength ?? 0))
      return orig(...args)
    })

    // ─── Draw-call count ─────────────────────────────────────────────────────
    let draws = 0
    for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
      wrap(name, (orig, args) => { draws += 1; return orig(...args) })
    }

    // ─── GPU timer segments ──────────────────────────────────────────────────
    const fbNames = new Map()
    const fbName = (fb) => {
      if (!fb) return 'canvas'
      if (!fbNames.has(fb)) fbNames.set(fb, `fb${fbNames.size + 1}`)
      return fbNames.get(fb)
    }
    let drawFb = null
    let current = null
    let segments = []
    const pool = []
    const pending = []
    let viewport = [0, 0, 0, 0]

    const begin = (label) => {
      if (!ext || !state.recording) return
      const query = pool.pop() ?? gl.createQuery()
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query)
      current = { query, label, vp: `${viewport[2]}x${viewport[3]}` }
    }
    const end = () => {
      if (!current) return
      gl.endQuery(ext.TIME_ELAPSED_EXT)
      segments.push(current)
      current = null
    }
    wrap('viewport', (orig, [x, y, w, h]) => {
      viewport = [x, y, w, h]
      if (current && current.label !== 'blit') current.vp = `${w}x${h}`
      return orig(x, y, w, h)
    })
    wrap('bindFramebuffer', (orig, [target, fb]) => {
      const result = orig(target, fb)
      if (target === GL.FRAMEBUFFER || target === GL.DRAW_FRAMEBUFFER) {
        drawFb = fb
        end()
        begin(fbName(fb))
      }
      return result
    })
    wrap('blitFramebuffer', (orig, args) => {
      end()
      begin('blit')
      if (current) current.vp = `${args[6] - args[4]}x${args[7] - args[5]}`
      const result = orig(...args)
      end()
      begin(fbName(drawFb))
      return result
    })

    const resolve = () => {
      while (pending.length > 0) {
        const frame = pending[0]
        const last = frame.segments[frame.segments.length - 1]
        if (last && !gl.getQueryParameter(last.query, gl.QUERY_RESULT_AVAILABLE)) return
        pending.shift()
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT)
        const passes = {}
        const seen = {}
        let total = 0
        for (const segment of frame.segments) {
          const ms = gl.getQueryParameter(segment.query, gl.QUERY_RESULT) / 1e6
          pool.push(segment.query)
          const base = `${segment.label} ${segment.vp}`
          seen[base] = (seen[base] ?? 0) + 1
          const key = seen[base] > 1 ? `${base} #${seen[base]}` : base
          passes[key] = (passes[key] ?? 0) + ms
          total += ms
        }
        if (disjoint) ctx.disjointFrames += 1
        else ctx.gpuFrames.push({ total, passes, draws: frame.draws })
      }
    }

    const onFrame = () => {
      requestAnimationFrame(onFrame)
      ctx.totalDraws += draws
      if (ext) {
        end()
        if (segments.length > 0) pending.push({ segments, draws })
        segments = []
        resolve()
        begin(fbName(drawFb))
      }
      draws = 0
    }
    requestAnimationFrame(onFrame)
    ctx.flush = () => { if (!ext) return; end(); if (segments.length > 0) pending.push({ segments, draws }); segments = [] }
    ctx.pendingCount = () => pending.length
    ctx.resolve = () => { if (ext) resolve() }
  }

  const onFrame = (stamp) => {
    requestAnimationFrame(onFrame)
    if (state.recording) state.frameStamps.push(stamp)
  }
  requestAnimationFrame(onFrame)
  const sceneContext = () => state.contexts.reduce((best, c) => (!best || c.totalDraws > best.totalDraws ? c : best), null)

  const originalGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (type, attributes) {
    const context = originalGetContext.call(this, type, attributes)
    if (context && type === 'webgl2' && !context.__benchInstrumented) {
      context.__benchInstrumented = true
      instrument(context, attributes)
    }
    return context
  }

  const sum = (map) => { let total = 0; for (const v of map.values()) total += v; return total }
  const textureBytes = (entry) => sum(entry.levels)

  window.__bench = {
    get timerSupported() { return !!sceneContext()?.timerSupported },
    get contexts() { return state.contexts.length },
    start() {
      state.frameStamps = []
      for (const c of state.contexts) { c.gpuFrames = []; c.disjointFrames = 0 }
      state.recording = true
    },
    /** Stops recording; GPU results resolve a few frames later (see collect). */
    stop() {
      state.recording = false
      for (const c of state.contexts) c.flush()
    },
    collect() {
      const c = sceneContext()
      c?.resolve()
      return {
        frameStamps: state.frameStamps,
        gpuFrames: c?.gpuFrames ?? [],
        disjointFrames: c?.disjointFrames ?? 0,
        pendingGpuFrames: c?.pendingCount() ?? 0,
        contexts: state.contexts.length,
      }
    },
    memory() {
      const list = [...textures.values()].map((t) => ({ w: t.w, h: t.h, format: t.format, bytes: textureBytes(t) }))
      list.sort((a, b) => b.bytes - a.bytes)
      return {
        textureBytes: list.reduce((acc, t) => acc + t.bytes, 0),
        textureCount: list.length,
        renderbufferBytes: sum(renderbuffers),
        bufferBytes: sum(buffers),
        drawingBufferBytes: typeof drawingBuffer === 'function' ? drawingBuffer() : 0,
        largestTextures: list.slice(0, 12),
      }
    },
  }
})()
