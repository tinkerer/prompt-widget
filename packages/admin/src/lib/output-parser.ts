export type MessageRole = 'assistant' | 'tool_use' | 'tool_result' | 'user_input' | 'system' | 'thinking';

export interface ParsedMessage {
  id: string;
  role: MessageRole;
  timestamp: number;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  content: string;
  isError?: boolean;
}

let nextId = 0;
function genId(): string {
  return `msg-${++nextId}`;
}

function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b\(B/g, '')
    .replace(/\x1b\[[\?]?[0-9;]*[hlm]/g, '');
}

// Parses structured JSON output from `claude --output-format stream-json`
export class JsonOutputParser {
  private buffer = '';
  private messages: ParsedMessage[] = [];

  feed(chunk: string): ParsedMessage[] {
    this.buffer += chunk;
    const newMessages: ParsedMessage[] = [];

    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const obj = JSON.parse(trimmed);
        const msg = this.parseJsonEvent(obj);
        if (msg) {
          this.messages.push(msg);
          newMessages.push(msg);
        }
      } catch {
        // not JSON
      }
    }

    return newMessages;
  }

  private parseJsonEvent(obj: any): ParsedMessage | null {
    const type = obj.type;

    if (type === 'assistant' && obj.message?.content) {
      for (const block of obj.message.content) {
        if (block.type === 'text') {
          return { id: genId(), role: 'assistant', timestamp: Date.now(), content: block.text };
        }
        if (block.type === 'tool_use') {
          return {
            id: genId(),
            role: 'tool_use',
            timestamp: Date.now(),
            toolName: block.name,
            toolInput: block.input,
            content: JSON.stringify(block.input, null, 2),
          };
        }
      }
    }

    if (type === 'content_block_start' && obj.content_block) {
      const block = obj.content_block;
      if (block.type === 'tool_use') {
        return {
          id: genId(),
          role: 'tool_use',
          timestamp: Date.now(),
          toolName: block.name,
          toolInput: {},
          content: '',
        };
      }
    }

    if (type === 'result') {
      if (obj.subtype === 'error_message' || obj.is_error) {
        return { id: genId(), role: 'tool_result', timestamp: Date.now(), content: obj.result || obj.error || 'Error', isError: true };
      }
      if (obj.result) {
        return { id: genId(), role: 'tool_result', timestamp: Date.now(), content: obj.result };
      }
    }

    return null;
  }

  getMessages(): ParsedMessage[] {
    return this.messages;
  }
}

type ParserState = 'idle' | 'assistant_text' | 'tool_use' | 'tool_result' | 'thinking' | 'user_input';

// Heuristic state-machine parser for interactive terminal output from Claude CLI.
// Detects tool calls (⏺ ToolName), results (⎿), assistant text, thinking blocks, and user input.
export class TerminalOutputParser {
  private messages: ParsedMessage[] = [];
  private state: ParserState = 'idle';
  private accum = '';
  private currentToolName = '';
  private currentToolInput: Record<string, unknown> = {};
  private pendingLines: string[] = [];

  feed(chunk: string): ParsedMessage[] {
    const clean = stripAnsi(chunk);
    const newMessages: ParsedMessage[] = [];

    // Split into lines, keeping partial last line in pendingLines
    const raw = (this.pendingLines.length > 0 ? this.pendingLines.pop()! : '') + clean;
    const lines = raw.split('\n');
    // Keep last incomplete line
    this.pendingLines = [lines.pop() || ''];

    for (const line of lines) {
      const trimmed = line.trimEnd();
      const msgs = this.processLine(trimmed);
      newMessages.push(...msgs);
    }

    return newMessages;
  }

  private processLine(line: string): ParsedMessage[] {
    const results: ParsedMessage[] = [];

    // Detect tool use: ⏺ ToolName(arg) or ● ToolName
    const toolMatch = line.match(/^\s*[⏺●]\s+(\w+)(?:\(([^)]*)\))?/);
    if (toolMatch) {
      results.push(...this.flush());
      const toolName = toolMatch[1];
      const toolArg = toolMatch[2] || '';
      this.state = 'tool_use';
      this.currentToolName = toolName;
      this.currentToolInput = {};
      this.accum = '';

      if (toolName === 'Bash' && toolArg) {
        this.currentToolInput = { command: toolArg };
      } else if ((toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') && toolArg) {
        this.currentToolInput = { file_path: toolArg };
      } else if ((toolName === 'Glob' || toolName === 'Grep') && toolArg) {
        this.currentToolInput = { pattern: toolArg };
      } else if (toolArg) {
        this.currentToolInput = { args: toolArg };
      }
      return results;
    }

    // Detect tool result block: ⎿ ...
    const resultMatch = line.match(/^\s*⎿\s?(.*)/);
    if (resultMatch) {
      // First flush any tool_use that was accumulating params
      if (this.state === 'tool_use') {
        results.push(...this.flushToolUse());
      }
      // If we were already in tool_result, continue accumulating
      if (this.state !== 'tool_result') {
        results.push(...this.flush());
        this.state = 'tool_result';
        this.accum = '';
      }
      this.accum += (this.accum ? '\n' : '') + resultMatch[1];
      return results;
    }

    // Detect thinking marker
    if (/^\s*Thinking\.\.\.\s*$/.test(line) || /^\s*💭/.test(line)) {
      results.push(...this.flush());
      this.state = 'thinking';
      this.accum = '';
      return results;
    }

    // Detect user input marker (❯ or > prefix from Claude CLI)
    if (/^\s*[❯>]\s/.test(line)) {
      results.push(...this.flush());
      const content = line.replace(/^\s*[❯>]\s*/, '');
      if (content.trim()) {
        const msg: ParsedMessage = { id: genId(), role: 'user_input', timestamp: Date.now(), content: content.trim() };
        this.messages.push(msg);
        results.push(msg);
      }
      return results;
    }

    // Handle state-specific accumulation
    switch (this.state) {
      case 'tool_use':
        // Lines under a tool use header contain parameters
        // e.g. "  command: ls -la" or "  file_path: /foo/bar"
        {
          const paramMatch = line.match(/^\s{2,}(\w[\w_]*):\s*(.*)/);
          if (paramMatch) {
            const key = paramMatch[1];
            let val: string | boolean | number = paramMatch[2];
            if (val === 'true') val = true;
            else if (val === 'false') val = false;
            this.currentToolInput[key] = val;
          } else if (line.trim()) {
            // Could be a continuation of a multi-line value
            this.accum += (this.accum ? '\n' : '') + line;
          }
        }
        break;

      case 'tool_result':
        // Indented lines under ⎿ are continuation of result
        if (line.match(/^\s{2,}/) || line.trim() === '') {
          this.accum += '\n' + line;
        } else {
          // Non-indented non-empty line means end of result
          results.push(...this.flush());
          // Re-process this line in idle state
          this.state = 'idle';
          results.push(...this.processLine(line));
        }
        break;

      case 'thinking':
        if (line.trim() === '') {
          // Empty line might end thinking block
          results.push(...this.flush());
          this.state = 'idle';
        } else {
          this.accum += (this.accum ? '\n' : '') + line;
        }
        break;

      default:
        // idle or assistant_text
        if (line.trim()) {
          if (this.state !== 'assistant_text') {
            results.push(...this.flush());
            this.state = 'assistant_text';
            this.accum = '';
          }
          this.accum += (this.accum ? '\n' : '') + line;
        } else if (this.state === 'assistant_text' && this.accum) {
          // Empty line: flush assistant text
          results.push(...this.flush());
        }
        break;
    }

    return results;
  }

  private flushToolUse(): ParsedMessage[] {
    if (this.state !== 'tool_use') return [];
    const msg: ParsedMessage = {
      id: genId(),
      role: 'tool_use',
      timestamp: Date.now(),
      toolName: this.currentToolName,
      toolInput: { ...this.currentToolInput },
      content: this.accum.trim(),
    };
    this.messages.push(msg);
    this.state = 'idle';
    this.accum = '';
    this.currentToolName = '';
    this.currentToolInput = {};
    return [msg];
  }

  private flush(): ParsedMessage[] {
    const results: ParsedMessage[] = [];

    switch (this.state) {
      case 'tool_use':
        results.push(...this.flushToolUse());
        break;

      case 'tool_result': {
        const content = this.accum.trim();
        if (content) {
          const isError = content.includes('Error') || content.includes('error:') || content.includes('FAILED') || content.includes('Permission denied');
          const msg: ParsedMessage = { id: genId(), role: 'tool_result', timestamp: Date.now(), content, isError };
          this.messages.push(msg);
          results.push(msg);
        }
        break;
      }

      case 'assistant_text': {
        const content = this.accum.trim();
        if (content) {
          const msg: ParsedMessage = { id: genId(), role: 'assistant', timestamp: Date.now(), content };
          this.messages.push(msg);
          results.push(msg);
        }
        break;
      }

      case 'thinking': {
        const content = this.accum.trim();
        if (content) {
          const msg: ParsedMessage = { id: genId(), role: 'thinking', timestamp: Date.now(), content };
          this.messages.push(msg);
          results.push(msg);
        }
        break;
      }
    }

    this.state = 'idle';
    this.accum = '';
    return results;
  }

  getMessages(): ParsedMessage[] {
    return this.messages;
  }
}

export function createOutputParser(permissionProfile: string): JsonOutputParser | TerminalOutputParser {
  if (permissionProfile === 'auto' || permissionProfile === 'yolo') {
    return new JsonOutputParser();
  }
  return new TerminalOutputParser();
}
