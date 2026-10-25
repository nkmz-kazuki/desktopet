(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.modelConfig = factory();
})(typeof window === 'object' ? window : globalThis, () => {
  const MODEL_OPTIONS = Object.freeze([
    Object.freeze({ id: 'deepseek-flash', label: 'DeepSeek V4.1 Flash', group: 'Flash 系列' }),
    Object.freeze({ id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', group: 'Pro 系列' }),
  ]);
  const DEFAULT_MODEL = 'deepseek-flash';
  const DEFAULT_REASONING_EFFORT = 'max';
  const modelIds = new Set(MODEL_OPTIONS.map(({ id }) => id));

  function normalizeModelId(value) {
    return modelIds.has(value) ? value : DEFAULT_MODEL;
  }

  function normalizeReasoningEffort() {
    return DEFAULT_REASONING_EFFORT;
  }

  return Object.freeze({
    MODEL_OPTIONS, DEFAULT_MODEL, DEFAULT_REASONING_EFFORT,
    normalizeModelId, normalizeReasoningEffort,
  });
});
