// Extend the verified kokoro-js 1.2.1 build with an explicit phoneme callback.
// An upstream update must review this adapter; never silently lose progress.
const GENERATE = 'async generate(e,{voice:a="af_heart",speed:t=1}={}){const r=this._validate_voice(a),n=await m(e,r),{input_ids:l}=this.tokenizer(n,{truncation:!0});return this.generate_from_ids(l,{voice:a,speed:t})}';
export function withPhonemeProgress(source) {
  if (source.split(GENERATE).length !== 2) throw new Error("Unsupported kokoro-js generate implementation; review the phoneme-progress adapter before upgrading");
  const patched = GENERATE.replace('speed:t=1}', 'speed:t=1,onPhonemes:notifyPhonemes}').replace(',{input_ids:l}=this.tokenizer', ';notifyPhonemes?.(n);const{input_ids:l}=this.tokenizer');
  return '// Modified for offline-speech: explicit onPhonemes callback after phonemization.\n' + source.replace(GENERATE, patched);
}
