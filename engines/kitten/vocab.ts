/**
 * KittenTTS TextCleaner vocabulary — GENERATED, do not hand-edit.
 *
 * Source: KittenML/KittenTTS kittentts_legacy/onnx_model.py TextCleaner (Apache-2.0), extracted 2026-11-04
 * Regenerate from scripts/kitten-vocab.json if the upstream TextCleaner
 * ever changes. Symbol order defines the token ids: [pad] + punctuation
 * + letters + IPA, i.e. id 0 = "\$", id 10 = "…".
 */
export const KITTEN_PAD = "$";
export const KITTEN_PUNCTUATION = ";:,.!?¡¿—…\"«»\"\" ";
export const KITTEN_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const KITTEN_LETTERS_IPA = "ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ";

const SYMBOLS: string[] = [
  KITTEN_PAD,
  ...KITTEN_PUNCTUATION,
  ...KITTEN_LETTERS,
  ...KITTEN_LETTERS_IPA,
];

/** char -> token id, mirroring the official TextCleaner dict. */
export const KITTEN_VOCAB: ReadonlyMap<string, number> = new Map(
  SYMBOLS.map((s, i) => [s, i] as [string, number]),
);
