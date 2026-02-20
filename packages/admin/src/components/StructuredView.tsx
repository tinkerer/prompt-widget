import { useEffect, useRef, useState } from 'preact/hooks';
import { MessageRenderer } from './MessageRenderer.js';
import { TerminalOutputParser, type ParsedMessage } from '../lib/output-parser.js';

interface Props {
  sessionId: string;
  isActive?: boolean;
}

interface MessageGroup {
  id: string;
  messages: ParsedMessage[];
  role: 'assistant_group' | 'user_input' | 'standalone';
}

function groupMessages(messages: ParsedMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let currentGroup: ParsedMessage[] | null = null;

  for (const msg of messages) {
    const isAssistantLike = msg.role === 'assistant' || msg.role === 'tool_use' || msg.role === 'tool_result' || msg.role === 'thinking';

    if (isAssistantLike) {
      if (!currentGroup) {
        currentGroup = [msg];
      } else {
        currentGroup.push(msg);
      }
    } else {
      if (currentGroup) {
        groups.push({ id: currentGroup[0].id, messages: currentGroup, role: 'assistant_group' });
        currentGroup = null;
      }
      groups.push({ id: msg.id, messages: [msg], role: msg.role === 'user_input' ? 'user_input' : 'standalone' });
    }
  }

  if (currentGroup) {
    groups.push({ id: currentGroup[0].id, messages: currentGroup, role: 'assistant_group' });
  }

  return groups;
}

export function StructuredView({ sessionId, isActive }: Props) {
  const [messages, setMessages] = useState<ParsedMessage[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const parserRef = useRef(new TerminalOutputParser());
  const cleanedUp = useRef(false);
  const autoScroll = useRef(true);

  useEffect(() => {
    cleanedUp.current = false;
    parserRef.current = new TerminalOutputParser();

    const token = localStorage.getItem('pw-admin-token');
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/agent-session?sessionId=${sessionId}&token=${token}`;

    function connect() {
      if (cleanedUp.current) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          let data: string | undefined;

          if (msg.type === 'sequenced_output' && msg.content?.data) {
            data = msg.content.data;
          } else if (msg.type === 'output' && msg.data) {
            data = msg.data;
          } else if (msg.type === 'history' && msg.data) {
            data = msg.data;
          }

          if (data) {
            const newMsgs = parserRef.current.feed(data);
            if (newMsgs.length > 0) {
              setMessages(prev => [...prev, ...newMsgs]);
            }
          }
        } catch {}
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!cleanedUp.current) {
          setTimeout(connect, 2000);
        }
      };
    }

    connect();

    return () => {
      cleanedUp.current = true;
      wsRef.current?.close();
    };
  }, [sessionId]);

  useEffect(() => {
    if (autoScroll.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  };

  const groups = groupMessages(messages);

  return (
    <div class="structured-view" ref={containerRef} onScroll={handleScroll}>
      {messages.length === 0 && (
        <div class="sm-empty">Waiting for structured output...</div>
      )}
      {groups.map(group => (
        <div key={group.id} class={`sm-group sm-group-${group.role}`}>
          {group.messages.map(msg => (
            <MessageRenderer key={msg.id} message={msg} />
          ))}
        </div>
      ))}
    </div>
  );
}
