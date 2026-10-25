// ─── patch-basis-transcoder.mjs — CSP-safe Basis transcoder ─────────────────
//
// `public/basis/basis_transcoder.js` is three's copy of the Basis Universal
// transcoder glue (three/examples/jsm/libs/basis), built by Emscripten with
// embind's default DYNAMIC_EXECUTION=1: every bound C++ method gets a JS
// invoker generated with `new Function(...)`. The production CSP
// (`script-src 'self' 'wasm-unsafe-eval'`, vercel.json) forbids string
// evaluation, and KTX2Loader's blob: workers inherit that policy, so module
// init threw EvalError inside every worker. The worker swallows the failure
// (its init promise never resolves), so every KTX2 texture — and the whole
// IGOAL GLB load — hung forever on the live site. vite preview sends no CSP,
// which is why it only reproduced in production.
//
// This script copies three's transcoder into public/basis/ and replaces the
// two code-generation sites with the closure-based equivalents Emscripten
// emits for DYNAMIC_EXECUTION=0 (same argument wiring, destructors and
// return conversion). The .wasm is copied unchanged. Re-run it whenever three
// is upgraded:
//
//   node scripts/patch-basis-transcoder.mjs
//
// tests/unit/rendering/BasisTranscoderCsp.test.ts runs the result in a V8
// context with string code generation disabled and transcodes a real KTX2
// texture from the shipped asset.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const THREE_BASIS_DIR = 'node_modules/three/examples/jsm/libs/basis'
export const PUBLIC_BASIS_DIR = 'public/basis'

// embind craftInvokerFunction: method/constructor/function invokers.
const INVOKER_FROM =
  'let[args,invokerFnBody]=createJsInvoker(argTypes,isClassMethodFunc,returns,isAsync);'
  + 'args.push(invokerFnBody);var invokerFn=newFunc(Function,args)(...closureArgs);'
  + 'return createNamedFunction(humanName,invokerFn)}'
const INVOKER_TO =
  'var expectedArgCount=argCount-2;'
  + 'var invokerFn=function(...args){'
  + 'if(args.length!==expectedArgCount){throwBindingError("function "+humanName+" called with "+args.length+" arguments, expected "+expectedArgCount)}'
  + 'var destructors=needsDestructorStack?[]:null;'
  + 'var wired=[cppTargetFunc];'
  + 'if(isClassMethodFunc){wired.push(argTypes[1]["toWireType"](destructors,this))}'
  + 'for(var i=0;i<expectedArgCount;++i){wired.push(argTypes[i+2]["toWireType"](destructors,args[i]))}'
  + 'var rv=cppInvokerFunc(...wired);'
  + 'if(needsDestructorStack){runDestructors(destructors)}'
  + 'else{for(var i=isClassMethodFunc?1:2;i<argTypes.length;++i){'
  + 'if(argTypes[i].destructorFunction!==null){argTypes[i].destructorFunction(wired[isClassMethodFunc?i:i-1])}}}'
  + 'if(returns){return argTypes[0]["fromWireType"](rv)}};'
  + 'return createNamedFunction(humanName,invokerFn)}'

// emval method callers (C++ calling JS methods through `val`).
const METHOD_CALLER_FROM = /var __emval_get_method_caller=\(argCount,argTypes,kind\)=>\{.*?return emval_addMethodCaller\(createNamedFunction\(functionName,invokerFunction\)\)\};/s
const METHOD_CALLER_TO =
  'var __emval_get_method_caller=(argCount,argTypes,kind)=>{'
  + 'var types=emval_lookupTypes(argCount,argTypes);var retType=types.shift();argCount--;'
  + 'var invokerFunction=(obj,func,destructorsRef,args)=>{'
  + 'var offset=0;var argv=kind===0?[obj]:[];'
  + 'for(var i=0;i<argCount;++i){argv.push(types[i].readValueFromPointer(args+offset));offset+=types[i]["argPackAdvance"]}'
  + 'var rv=kind===1?Reflect.construct(func,argv):func.call(...argv);'
  + 'if(!retType.isVoid){return emval_returnValue(retType,destructorsRef,rv)}};'
  + 'var functionName=`methodCaller<(${types.map(t=>t.name).join(", ")}) => ${retType.name}>`;'
  + 'return emval_addMethodCaller(createNamedFunction(functionName,invokerFunction))};'

/** Marker proving the file went through this script. */
export const PATCH_MARKER = '/* orbital: CSP-safe embind invokers (scripts/patch-basis-transcoder.mjs) */'

/**
 * Rewrite three's transcoder glue so it never evaluates strings. Throws if
 * the glue no longer has the expected shape (a three upgrade changed it), so
 * a silent half-patch can never ship.
 */
export function patchBasisTranscoder(source) {
  const text = source.replace(/\r\n/g, '\n')
  if (text.startsWith(PATCH_MARKER)) return text
  const invokerCount = text.split(INVOKER_FROM).length - 1
  if (invokerCount !== 1) {
    throw new Error(`basis transcoder: expected 1 craftInvokerFunction site, found ${invokerCount}`)
  }
  if (!METHOD_CALLER_FROM.test(text)) {
    throw new Error('basis transcoder: __emval_get_method_caller has an unexpected shape')
  }
  const patched = text.replace(INVOKER_FROM, INVOKER_TO).replace(METHOD_CALLER_FROM, METHOD_CALLER_TO)
  if (/newFunc\(Function/.test(patched)) {
    throw new Error('basis transcoder: dynamic code generation remains after patching')
  }
  return `${PATCH_MARKER}\n${patched}`
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = readFileSync(path.join(THREE_BASIS_DIR, 'basis_transcoder.js'), 'utf8')
  writeFileSync(path.join(PUBLIC_BASIS_DIR, 'basis_transcoder.js'), patchBasisTranscoder(source))
  writeFileSync(
    path.join(PUBLIC_BASIS_DIR, 'basis_transcoder.wasm'),
    readFileSync(path.join(THREE_BASIS_DIR, 'basis_transcoder.wasm')),
  )
  console.log(`patched ${PUBLIC_BASIS_DIR}/basis_transcoder.js (CSP-safe), copied .wasm`)
}
