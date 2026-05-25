import { AsyncLocalStorage } from 'node:async_hooks';

export class LLMStreamAccumulator {
  reasoningText = '';
  normalText = '';
  hasSentText = false;
  hasSentReasoning = false;
  hasSentReasoningClosed = false;
  isInPatchedInvoke = false;
  sender?: any;
  channel?: string;

  appendReasoning(text: string): void {
    this.reasoningText += text;
    if (this.isInPatchedInvoke && this.sender && this.channel) {
      if (!this.hasSentReasoning) {
        this.hasSentReasoning = true;
        this.sender.send(this.channel, { type: 'message_chunk', text: '<think>' });
      }
      this.sender.send(this.channel, { type: 'message_chunk', text });
    }
  }

  appendText(text: string): void {
    this.normalText += text;
    if (this.isInPatchedInvoke && this.sender && this.channel) {
      if (this.hasSentReasoning && !this.hasSentReasoningClosed) {
        this.sender.send(this.channel, { type: 'message_chunk', text: '</think>\n\n' });
        this.hasSentReasoningClosed = true;
      }
      this.hasSentText = true;
      this.sender.send(this.channel, { type: 'message_chunk', text });
    }
  }

  takeReasoning(): string {
    const text = this.reasoningText;
    this.reasoningText = '';
    return text;
  }

  clearText(): void {
    this.normalText = '';
  }
}

const streamAccumulatorStorage = new AsyncLocalStorage<LLMStreamAccumulator>();

export function createStreamAccumulator(): LLMStreamAccumulator {
  return new LLMStreamAccumulator();
}

export function runWithStreamAccumulator<T>(
  accumulator: LLMStreamAccumulator,
  callback: () => Promise<T>
): Promise<T> {
  return streamAccumulatorStorage.run(accumulator, callback);
}

export function getCurrentStreamAccumulator(): LLMStreamAccumulator | undefined {
  return streamAccumulatorStorage.getStore();
}

export function appendCurrentReasoning(text: string): void {
  getCurrentStreamAccumulator()?.appendReasoning(text);
}

export function appendCurrentText(text: string): void {
  getCurrentStreamAccumulator()?.appendText(text);
}
