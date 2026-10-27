import type { BrainResponse, FormElement } from '@vfe/protocol';

import type { LlmCompleteArgs, LlmProvider, TokenUsage } from './types';

interface PageElement extends Partial<FormElement> {
  id?: string;
  n?: number;
  label?: string;
  type?: FormElement['type'];
}

const ORDINALS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

function parsePayload(args: LlmCompleteArgs): { elements: PageElement[]; transcript: string } {
  const message = args.messages.at(-1)?.content ?? '';
  const page = /PAGE STATE:\n([\s\S]*?)\n\nTRANSCRIPT:\n([\s\S]*)$/.exec(message);
  if (!page) return { elements: [], transcript: message };
  try {
    const parsed = JSON.parse(page[1] ?? '{}') as { elements?: PageElement[] };
    return { elements: parsed.elements ?? [], transcript: page[2] ?? '' };
  } catch {
    return { elements: [], transcript: page[2] ?? '' };
  }
}

function spokenEmail(transcript: string): string | null {
  const match = /([\w.+-]+)\s+at\s+([\w.-]+)\s+dot\s+(\w+)/i.exec(transcript);
  if (match) return `${match[1]}@${match[2]}.${match[3]}`;
  const direct = /[\w.+-]+@[\w.-]+\.\w+/.exec(transcript);
  return direct ? direct[0] : null;
}

function valueAfter(transcript: string): string | null {
  const quoted = /["“']([^"”']+)["”']/.exec(transcript);
  if (quoted?.[1]) return quoted[1];
  const put = /(?:put|set|type|enter|enter)\s+(.+?)\s+(?:in|into|for|as)\b/i.exec(transcript);
  if (put?.[1]) return put[1].replace(/\s+field\s+\d+$/i, '').trim();
  const digits = /\b(\d{4,10})\b/.exec(transcript);
  return digits?.[1] ?? null;
}

/**
 * Deterministic, key-free provider used by MOCK_LLM=1, CI and local
 * development. It covers the common voice commands and always returns a
 * schema-valid response. Real eval assertions use scenario mock blocks.
 */
export class MockProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model = 'mock-deterministic';

  async complete(args: LlmCompleteArgs): Promise<{ parsed: unknown; usage: TokenUsage }> {
    return { parsed: this.build(args), usage: { promptTokens: 0, completionTokens: 0 } };
  }

  private build(args: LlmCompleteArgs): BrainResponse {
    const { elements, transcript } = parsePayload(args);
    const lower = transcript.toLowerCase();
    const actions: BrainResponse['actions'] = [];

    const byBadge = (index: number): PageElement | undefined =>
      elements.find((element) => element.n === index);
    const badgeMatch = /(?:field|number|box)\s+(\d+)/i.exec(lower);
    const ordinalMatch = /(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)/i.exec(
      lower,
    );
    const badge = badgeMatch?.[1]
      ? Number(badgeMatch[1])
      : ordinalMatch?.[1]
        ? ORDINALS[ordinalMatch[1].toLowerCase()]
        : undefined;

    if (/\b(check|tick|toggle)\b/.test(lower) && badge) {
      const target = byBadge(badge);
      if (target?.id) {
        actions.push({ action: 'SET_CHECKED', targetId: target.id, checked: true });
        return this.wrap('Check the requested box.', 'Checked it.', actions);
      }
    }

    if (/\b(select|choose|pick)\b/.test(lower)) {
      const select = elements.find(
        (element) => element.type === 'select' || element.type === 'combobox',
      );
      if (select?.id) {
        const wanted = /\b(?:select|choose|pick)\s+([a-z .'-]+?)(?:\s+please)?$/i
          .exec(transcript)?.[1]
          ?.trim();
        if (wanted) {
          actions.push({ action: 'SELECT', targetId: select.id, value: wanted });
          return this.wrap('Select the requested option.', `Selected ${wanted}.`, actions);
        }
      }
    }

    const email = spokenEmail(transcript);
    if (email) {
      const target = elements.find((element) => element.type === 'email');
      if (target?.id) {
        actions.push({ action: 'FILL', targetId: target.id, value: email });
        return this.wrap('Email address dictated.', 'Filled in your email.', actions);
      }
    }

    if (badge) {
      const target = byBadge(badge);
      const value = valueAfter(transcript);
      if (target?.id && value) {
        actions.push({ action: 'FILL', targetId: target.id, value });
        return this.wrap('Badge reference with a value.', `Filled field ${badge}.`, actions);
      }
    }

    const name = /(?:my name is|i am|i'm)\s+([a-z]+)(?:\s+([a-z]+))?/i.exec(transcript);
    if (name) {
      const first = elements.find((element) => /first/i.test(element.label ?? ''));
      const last = elements.find((element) => /last/i.test(element.label ?? ''));
      if (first?.id && name[1])
        actions.push({ action: 'FILL', targetId: first.id, value: name[1] });
      if (last?.id && name[2]) actions.push({ action: 'FILL', targetId: last.id, value: name[2] });
      if (actions.length > 0) return this.wrap('Name dictated.', 'Filled in your name.', actions);
    }

    if (/\b(next|continue|submit|pay|place order|sign in|log in)\b/.test(lower)) {
      const button = elements.find(
        (element) =>
          element.type === 'button' &&
          /submit|continue|next|pay|sign in|log in/i.test(element.label ?? ''),
      );
      if (button?.id) {
        actions.push({ action: 'CLICK', targetId: button.id });
        return this.wrap('User asked to continue.', 'Continuing.', actions);
      }
    }

    return this.wrap(
      'No matching field for the spoken request.',
      'I could not find a field for that. Could you repeat it?',
      [{ action: 'ASK_CLARIFICATION', questionToUser: 'Which field should I fill?' }],
    );
  }

  private wrap(thought: string, spoken: string, actions: BrainResponse['actions']): BrainResponse {
    return { thoughtProcess: thought, spokenFeedback: spoken, actions };
  }
}
