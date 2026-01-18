export function sharedStylesTag() {
  const env = globalThis?.process?.env;
  const isTest = env?.NODE_ENV === 'test' || env?.VITEST === 'true';
  if (isTest) return '';
  return '<style>@import url("styles.css");</style>';
}

