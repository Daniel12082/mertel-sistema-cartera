export const META_TEST_TEMPLATE_NAME = 'hello_world';
export const META_TEST_TEMPLATE_MESSAGE = 'La plantilla hello_world solo se puede enviar desde un número de prueba de Meta. Elige una plantilla aprobada de MERTEL.';

export function describeWhatsAppTextTemplate(template) {
  if (template?.status !== 'APPROVED' || template.category === 'AUTHENTICATION') return null;
  const components = [];
  for (const definition of template.components) {
    if (definition.type === 'BUTTONS' && definition.buttons?.every(button => button.type === 'QUICK_REPLY' && typeof button.text === 'string')) {
      components.push(...definition.buttons.map((button, index) => ({ type: 'button', index, text: button.text, variables: [] })));
      continue;
    }
    if (!['HEADER', 'BODY', 'FOOTER'].includes(definition.type) || typeof definition.text !== 'string' ||
        (definition.type === 'HEADER' && definition.format !== 'TEXT')) return null;
    const variables = [...new Set(Array.from(definition.text.matchAll(/\{\{\s*([a-z][a-z0-9_]*|[1-9]\d*)\s*\}\}/g), match => match[1]))];
    if (variables.every(variable => /^\d+$/.test(variable))) variables.sort((a, b) => Number(a) - Number(b));
    if (/\{\{|\}\}/.test(definition.text.replace(/\{\{\s*([a-z][a-z0-9_]*|[1-9]\d*)\s*\}\}/g, '')) ||
        (definition.type === 'FOOTER' && variables.length)) return null;
    components.push({ type: definition.type.toLowerCase(), text: definition.text, variables });
  }
  return components.some(component => component.type === 'body') ? components : null;
}

export function prepareWhatsAppTextTemplate(definitions, values) {
  const expected = definitions.flatMap(component => component.variables);
  if (!Array.isArray(values) || values.length !== expected.length ||
      values.some(value => typeof value !== 'string' || !value.trim() || value.trim().length > 1024 || /[\r\n\t\u0000-\u001f]/.test(value))) return null;
  let position = 0;
  const components = [];
  const blocks = [];
  for (const definition of definitions) {
    if (definition.type === 'button') {
      components.push({ type: 'button', sub_type: 'quick_reply', index: String(definition.index),
        parameters: [{ type: 'payload', payload: definition.text }] });
      continue;
    }
    const replacements = new Map(definition.variables.map(variable => [variable, values[position++].trim()]));
    if (replacements.size) components.push({ type: definition.type, parameters: [...replacements].map(([variable, value]) => ({
      type: 'text', text: value, ...(/^\d+$/.test(variable) ? {} : { parameter_name: variable }),
    })) });
    blocks.push(definition.text.replace(/\{\{\s*([a-z][a-z0-9_]*|[1-9]\d*)\s*\}\}/g, (_, variable) => replacements.get(variable)));
  }
  return { content: blocks.join('\n\n'), components };
}
