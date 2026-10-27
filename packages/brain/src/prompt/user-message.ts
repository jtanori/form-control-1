import type { ProcessCommandRequest } from '@vfe/protocol';

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Compact, token-cheap serialisation of the page for the model.
 * Short keys (`n`, `ph`, `group`) cut 20–30% of the prompt.
 */
export function buildUserMessage(req: ProcessCommandRequest): string {
  const elements = req.pageState.elements.map((element) => ({
    id: element.id,
    n: element.badgeIndex,
    type: element.type,
    label: element.label,
    ...(element.groupLabel ? { group: element.groupLabel } : {}),
    ...(element.placeholder ? { ph: element.placeholder } : {}),
    ...(element.options?.length
      ? { options: element.options.slice(0, 40).map((option) => option.label) }
      : {}),
    ...(element.value !== '' && element.value !== false
      ? { value: truncate(String(element.value), 200) }
      : {}),
    ...(element.required ? { required: true } : {}),
    ...(element.disabled ? { disabled: true } : {}),
    ...(element.validationError ? { error: truncate(element.validationError, 120) } : {}),
    ...(element.focused ? { focused: true } : {}),
  }));

  return JSON.stringify({
    title: req.pageState.urlOrAppTitle,
    elements,
    ...(req.pageState.globalErrors?.length ? { globalErrors: req.pageState.globalErrors } : {}),
  });
}

/** Conversation history, oldest first, trimmed to the last 20 turns. */
export function buildMessages(req: ProcessCommandRequest): Array<{
  role: 'user' | 'assistant';
  content: string;
}> {
  const history = req.conversationHistory.slice(-20).map((turn) => ({
    role: turn.role,
    content: turn.text,
  }));
  return [
    ...history,
    {
      role: 'user' as const,
      content: `PAGE STATE:\n${buildUserMessage(req)}\n\nTRANSCRIPT:\n${req.transcript}`,
    },
  ];
}
