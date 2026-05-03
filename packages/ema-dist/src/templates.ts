const TOKEN_PATTERN = /\{\{([A-Za-z0-9_]+)\}\}/gu;

export function renderTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(TOKEN_PATTERN, (token, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`Missing template value for ${token}.`);
    }
    return value;
  });
}
