import { useState } from 'preact/hooks';
import type { ParsedMessage } from '../lib/output-parser.js';

interface Props {
  message: ParsedMessage;
}

export function MessageRenderer({ message }: Props) {
  switch (message.role) {
    case 'tool_use':
      return <ToolUseMessage message={message} />;
    case 'tool_result':
      return <ToolResultMessage message={message} />;
    case 'assistant':
      return <AssistantMessage message={message} />;
    case 'user_input':
      return <UserInputMessage message={message} />;
    case 'thinking':
      return <ThinkingMessage message={message} />;
    case 'system':
      return <SystemMessage message={message} />;
    default:
      return null;
  }
}

// Tool-specific category colors
function toolCategory(name: string): string {
  switch (name) {
    case 'Bash': return 'tool-bash';
    case 'Edit': return 'tool-edit';
    case 'Write': return 'tool-write';
    case 'Read': return 'tool-read';
    case 'Glob':
    case 'Grep': return 'tool-search';
    case 'TodoWrite': return 'tool-todo';
    case 'Task': return 'tool-task';
    case 'WebFetch':
    case 'WebSearch': return 'tool-web';
    default: return 'tool-default';
  }
}

function toolIcon(name: string): string {
  switch (name) {
    case 'Bash': return '$';
    case 'Edit': return '✎';
    case 'Write': return '✏';
    case 'Read': return '📄';
    case 'Glob': return '🔍';
    case 'Grep': return '⌕';
    case 'TodoWrite': return '☑';
    case 'Task': return '⚙';
    case 'WebFetch':
    case 'WebSearch': return '🌐';
    default: return '▶';
  }
}

function ToolUseMessage({ message }: Props) {
  const { toolName, toolInput } = message;
  if (!toolName) return null;

  const cat = toolCategory(toolName);

  switch (toolName) {
    case 'Bash':
      return <BashToolUse toolInput={toolInput} cat={cat} />;
    case 'Edit':
      return <EditToolUse toolInput={toolInput} cat={cat} />;
    case 'Write':
      return <WriteToolUse toolInput={toolInput} cat={cat} />;
    case 'Read':
      return <ReadToolUse toolInput={toolInput} cat={cat} />;
    case 'Glob':
    case 'Grep':
      return <SearchToolUse toolName={toolName} toolInput={toolInput} cat={cat} />;
    case 'TodoWrite':
      return <TodoToolUse toolInput={toolInput} cat={cat} />;
    default:
      return <GenericToolUse toolName={toolName} toolInput={toolInput} cat={cat} />;
  }
}

function BashToolUse({ toolInput, cat }: { toolInput?: Record<string, unknown>; cat: string }) {
  const command = String(toolInput?.command || '');
  const description = toolInput?.description ? String(toolInput.description) : null;
  const timeout = toolInput?.timeout ? Number(toolInput.timeout) : null;
  const background = toolInput?.run_in_background === true || toolInput?.run_in_background === 'true';

  return (
    <div class={`sm-message sm-tool-use ${cat}`}>
      <div class="sm-tool-header">
        <span class="sm-tool-icon">$</span>
        <span class="sm-tool-name">Bash</span>
        {background && <span class="sm-tool-badge bg">background</span>}
        {timeout && <span class="sm-tool-badge">timeout: {Math.round(timeout / 1000)}s</span>}
      </div>
      {description && <div class="sm-tool-desc">{description}</div>}
      <pre class="sm-bash-command">{command}</pre>
    </div>
  );
}

function EditToolUse({ toolInput, cat }: { toolInput?: Record<string, unknown>; cat: string }) {
  const filePath = String(toolInput?.file_path || '');
  const oldStr = String(toolInput?.old_string || '');
  const newStr = String(toolInput?.new_string || '');
  const replaceAll = toolInput?.replace_all === true || toolInput?.replace_all === 'true';

  const diffLines = computeDiff(oldStr, newStr);

  return (
    <div class={`sm-message sm-tool-use ${cat}`}>
      <div class="sm-tool-header">
        <span class="sm-tool-icon">✎</span>
        <span class="sm-tool-name">Edit</span>
        {replaceAll && <span class="sm-tool-badge">replace all</span>}
        <span class="sm-file-path">{shortenPath(filePath)}</span>
      </div>
      {diffLines.length > 0 && (
        <div class="sm-diff-view">
          {diffLines.map((dl, i) => (
            <div key={i} class={`sm-diff-line sm-diff-${dl.type}`}>
              <span class="sm-diff-marker">{dl.type === 'removed' ? '-' : dl.type === 'added' ? '+' : ' '}</span>
              <span class="sm-diff-text">{dl.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WriteToolUse({ toolInput, cat }: { toolInput?: Record<string, unknown>; cat: string }) {
  const filePath = String(toolInput?.file_path || '');
  const content = String(toolInput?.content || '');
  const [expanded, setExpanded] = useState(false);

  const lines = content.split('\n');
  const displayLines = expanded ? lines : lines.slice(0, 20);
  const truncated = lines.length > 20 && !expanded;

  return (
    <div class={`sm-message sm-tool-use ${cat}`}>
      <div class="sm-tool-header">
        <span class="sm-tool-icon">✏</span>
        <span class="sm-tool-name">Write</span>
        <span class="sm-file-path">{shortenPath(filePath)}</span>
        <span class="sm-tool-badge">{lines.length} lines</span>
      </div>
      <div class="sm-line-numbered">
        {displayLines.map((ln, i) => (
          <div key={i} class="sm-numbered-line">
            <span class="sm-line-num">{i + 1}</span>
            <span class="sm-line-text">{ln}</span>
          </div>
        ))}
        {truncated && (
          <div class="sm-truncated" onClick={() => setExpanded(true)}>
            ... {lines.length - 20} more lines (click to expand)
          </div>
        )}
      </div>
    </div>
  );
}

function ReadToolUse({ toolInput, cat }: { toolInput?: Record<string, unknown>; cat: string }) {
  const filePath = String(toolInput?.file_path || '');
  const offset = toolInput?.offset ? Number(toolInput.offset) : null;
  const limit = toolInput?.limit ? Number(toolInput.limit) : null;

  let rangeInfo = '';
  if (offset && limit) rangeInfo = `lines ${offset}-${offset + limit}`;
  else if (offset) rangeInfo = `from line ${offset}`;
  else if (limit) rangeInfo = `first ${limit} lines`;

  return (
    <div class={`sm-message sm-tool-use ${cat}`}>
      <div class="sm-tool-header">
        <span class="sm-tool-icon">📄</span>
        <span class="sm-tool-name">Read</span>
        <span class="sm-file-path">{shortenPath(filePath)}</span>
        {rangeInfo && <span class="sm-tool-badge">{rangeInfo}</span>}
      </div>
    </div>
  );
}

function SearchToolUse({ toolName, toolInput, cat }: { toolName: string; toolInput?: Record<string, unknown>; cat: string }) {
  const pattern = String(toolInput?.pattern || '');
  const path = toolInput?.path ? String(toolInput.path) : null;

  return (
    <div class={`sm-message sm-tool-use ${cat}`}>
      <div class="sm-tool-header">
        <span class="sm-tool-icon">{toolName === 'Glob' ? '🔍' : '⌕'}</span>
        <span class="sm-tool-name">{toolName}</span>
        <code class="sm-search-pattern">{pattern}</code>
        {path && <span class="sm-file-path">{shortenPath(path)}</span>}
      </div>
    </div>
  );
}

function TodoToolUse({ toolInput, cat }: { toolInput?: Record<string, unknown>; cat: string }) {
  const todos = toolInput?.todos as Array<{ content: string; status: string }> | undefined;

  return (
    <div class={`sm-message sm-tool-use ${cat}`}>
      <div class="sm-tool-header">
        <span class="sm-tool-icon">☑</span>
        <span class="sm-tool-name">TodoWrite</span>
      </div>
      {todos && todos.length > 0 && (
        <div class="sm-todo-list">
          {todos.map((t, i) => (
            <div key={i} class={`sm-todo-item sm-todo-${t.status}`}>
              <span class="sm-todo-status">
                {t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '→' : '○'}
              </span>
              <span>{t.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GenericToolUse({ toolName, toolInput, cat }: { toolName: string; toolInput?: Record<string, unknown>; cat: string }) {
  const icon = toolIcon(toolName);
  const [expanded, setExpanded] = useState(false);
  const hasInput = toolInput && Object.keys(toolInput).length > 0;

  return (
    <div class={`sm-message sm-tool-use ${cat}`}>
      <div class="sm-tool-header" onClick={() => hasInput && setExpanded(!expanded)} style={hasInput ? { cursor: 'pointer' } : undefined}>
        <span class="sm-tool-icon">{icon}</span>
        <span class="sm-tool-name">{toolName}</span>
        {hasInput && <span class="sm-expand-indicator">{expanded ? '▾' : '▸'}</span>}
      </div>
      {expanded && hasInput && (
        <pre class="sm-tool-summary">{JSON.stringify(toolInput, null, 2)}</pre>
      )}
    </div>
  );
}

function ToolResultMessage({ message }: Props) {
  const isError = message.isError;
  const content = message.content;
  const lines = content.split('\n');
  const isLong = lines.length > 15 || content.length > 500;
  const [expanded, setExpanded] = useState(!isLong);

  const displayContent = expanded ? content : lines.slice(0, 10).join('\n') + (lines.length > 10 ? '\n...' : '');

  return (
    <div class={`sm-message sm-tool-result ${isError ? 'sm-error' : ''}`}>
      <div class="sm-result-header" onClick={() => setExpanded(!expanded)}>
        <span class="sm-result-indicator">{expanded ? '▾' : '▸'}</span>
        <span class="sm-result-label">{isError ? 'Error' : 'Output'}</span>
        <span class="sm-result-meta">{lines.length} line{lines.length !== 1 ? 's' : ''}</span>
      </div>
      {(expanded || !isLong) && (
        <pre class="sm-result-content">{displayContent}</pre>
      )}
      {!expanded && isLong && (
        <pre class="sm-result-content sm-result-truncated">{displayContent}</pre>
      )}
    </div>
  );
}

function AssistantMessage({ message }: Props) {
  return (
    <div class="sm-message sm-assistant">
      <div class="sm-assistant-content">{renderMarkdownBasic(message.content)}</div>
    </div>
  );
}

function ThinkingMessage({ message }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div class="sm-message sm-thinking">
      <div class="sm-thinking-header" onClick={() => setExpanded(!expanded)}>
        <span class="sm-thinking-icon">💭</span>
        <span class="sm-thinking-label">Thinking</span>
        <span class="sm-expand-indicator">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div class="sm-thinking-content">{message.content}</div>
      )}
    </div>
  );
}

function UserInputMessage({ message }: Props) {
  return (
    <div class="sm-message sm-user-input">
      <div class="sm-user-bubble">{message.content}</div>
    </div>
  );
}

function SystemMessage({ message }: Props) {
  return (
    <div class="sm-message sm-system">
      <span class="sm-system-text">{message.content}</span>
    </div>
  );
}

// --- Utilities ---

function shortenPath(p: string): string {
  if (p.length <= 50) return p;
  const parts = p.split('/');
  if (parts.length <= 3) return p;
  return '.../' + parts.slice(-3).join('/');
}

interface DiffLine {
  type: 'context' | 'removed' | 'added';
  text: string;
}

function computeDiff(oldStr: string, newStr: string): DiffLine[] {
  if (!oldStr && !newStr) return [];
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');

  // LCS-based diff
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const result: DiffLine[] = [];
  let i = m, j = n;
  const stack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({ type: 'context', text: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'added', text: newLines[j - 1] });
      j--;
    } else {
      stack.push({ type: 'removed', text: oldLines[i - 1] });
      i--;
    }
  }

  stack.reverse();

  // Compact: only show context lines near changes (3 lines of context)
  const hasChanges = stack.some(l => l.type !== 'context');
  if (!hasChanges) return [];

  for (let k = 0; k < stack.length; k++) {
    const line = stack[k];
    if (line.type !== 'context') {
      result.push(line);
    } else {
      const nearChange = stack.slice(Math.max(0, k - 3), k).some(l => l.type !== 'context') ||
                         stack.slice(k + 1, k + 4).some(l => l.type !== 'context');
      if (nearChange) {
        result.push(line);
      } else if (result.length > 0 && result[result.length - 1].type !== 'context') {
        result.push({ type: 'context', text: '···' });
      }
    }
  }

  return result;
}

// Basic markdown rendering — handles bold, italic, code, inline code, headers
function renderMarkdownBasic(text: string): any {
  const lines = text.split('\n');
  const elements: any[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${i}`} class="sm-md-code-block">
            <code>{codeLines.join('\n')}</code>
          </pre>
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (line.startsWith('### ')) {
      elements.push(<h4 key={i} class="sm-md-h3">{inlineFormat(line.slice(4))}</h4>);
    } else if (line.startsWith('## ')) {
      elements.push(<h3 key={i} class="sm-md-h2">{inlineFormat(line.slice(3))}</h3>);
    } else if (line.startsWith('# ')) {
      elements.push(<h2 key={i} class="sm-md-h1">{inlineFormat(line.slice(2))}</h2>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(<div key={i} class="sm-md-li">• {inlineFormat(line.slice(2))}</div>);
    } else if (/^\d+\.\s/.test(line)) {
      const num = line.match(/^(\d+)\.\s/);
      elements.push(<div key={i} class="sm-md-li">{num?.[1]}. {inlineFormat(line.replace(/^\d+\.\s/, ''))}</div>);
    } else if (line.trim() === '') {
      elements.push(<div key={i} class="sm-md-break" />);
    } else {
      elements.push(<p key={i} class="sm-md-p">{inlineFormat(line)}</p>);
    }
  }

  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      <pre key="code-end" class="sm-md-code-block">
        <code>{codeLines.join('\n')}</code>
      </pre>
    );
  }

  return elements;
}

function inlineFormat(text: string): any {
  // Process inline code, bold, italic
  const parts: any[] = [];
  let remaining = text;
  let key = 0;

  while (remaining) {
    // Inline code
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)/s);
    if (codeMatch) {
      if (codeMatch[1]) parts.push(processEmphasis(codeMatch[1], key++));
      parts.push(<code key={key++} class="sm-md-inline-code">{codeMatch[2]}</code>);
      remaining = codeMatch[3];
      continue;
    }

    parts.push(processEmphasis(remaining, key++));
    break;
  }

  return parts;
}

function processEmphasis(text: string, key: number): any {
  // Bold
  const boldMatch = text.match(/^(.*?)\*\*(.+?)\*\*(.*)/s);
  if (boldMatch) {
    const parts: any[] = [];
    if (boldMatch[1]) parts.push(boldMatch[1]);
    parts.push(<strong key={`b-${key}`}>{boldMatch[2]}</strong>);
    if (boldMatch[3]) parts.push(processEmphasis(boldMatch[3], key + 100));
    return parts;
  }

  // Italic
  const italicMatch = text.match(/^(.*?)(?<!\*)\*([^*]+)\*(?!\*)(.*)/s);
  if (italicMatch) {
    const parts: any[] = [];
    if (italicMatch[1]) parts.push(italicMatch[1]);
    parts.push(<em key={`i-${key}`}>{italicMatch[2]}</em>);
    if (italicMatch[3]) parts.push(processEmphasis(italicMatch[3], key + 200));
    return parts;
  }

  return text;
}
