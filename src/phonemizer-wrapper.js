// Text-to-phoneme API for kokoro-js: `phonemize` and `list_voices`, as published by phonemizer 1.2.1.
// Adapted from phonemizer.js by Xenova (https://github.com/xenova/phonemizer.js, src/phonemizer.js
// at commit 6835144b7ee9043129222549c1ed2f6a27216278, version 1.2.1), licensed under the Apache
// License, Version 2.0. Changed for offline-speech: it starts the eSpeak NG module that
// scripts/build-espeak-ng.sh builds, through that module's factory, instead of a prebuilt module object.
// scripts/build-espeak-ng.sh appends this file to the generated module, which defines createESpeakNG.

const workerPromise = createESpeakNG().then((Module) => new Module.eSpeakNGWorker());

const SUPPORTED_LANGUAGES = [
  "en", // English
];

const initCache = workerPromise.then((worker) => {
  const voices = worker
    .list_voices()
    .map(({ name, identifier, languages }) => ({
      name,
      identifier,
      languages: languages.filter((lang) =>
        SUPPORTED_LANGUAGES.includes(lang.name.split("-")[0]),
      ),
    }))
    .filter((voice) => voice.languages.length > 0);

  // Generate list of supported language identifiers:
  const identifiers = new Set();
  for (const voice of voices) {
    identifiers.add(voice.identifier);
    for (const lang of voice.languages) {
      identifiers.add(lang.name);
    }
  }

  return { voices, identifiers };
});

/**
 * List the available voices for the specified language.
 * @param {string} [language] The language identifier
 * @returns {Promise<{name: string; identifier: string; languages: {name: string; priority: number}[]}>} A list of available voices
 */
export const list_voices = async (language) => {
  const { voices } = await initCache;
  if (!language) return voices;
  const base = language.split("-")[0];
  return voices.filter((voice) =>
    voice.languages.some(
      (lang) => lang.name === base || lang.name.startsWith(base + "-"),
    ),
  );
};

/**
 * Multilingual text to phonemes converter
 *
 * @param {string} text The input text
 * @param {string} [language] The language identifier
 * @returns {Promise<string[]>} A phonemized version of the input
 */
export const phonemize = async (text, language = "en-us") => {
  const worker = await workerPromise;

  const { identifiers } = await initCache;
  if (!identifiers.has(language)) {
    throw new Error(
      `Invalid language identifier: "${language}". Should be one of: ${Array.from(identifiers).toSorted().join(", ")}.`,
    );
  }
  worker.set_voice(language);

  return (
    worker
      .synthesize_ipa(text)
      .ipa?.split("\n")
      .filter((x) => x.length > 0) ?? []
  );
};
