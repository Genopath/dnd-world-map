import React from 'react';

// Lightweight markdown renderer — no external deps.
// Supports: # headings, **bold**, *italic*, `code`, - lists, line breaks.

function parseLine(line: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let rest = line;
  let key = 0;
  while (rest.length > 0) {
    const bold = rest.match(/^\*\*(.+?)\*\*/);
    if (bold) { nodes.push(<strong key={key++}>{bold[1]}</strong>); rest = rest.slice(bold[0].length); continue; }
    const italic = rest.match(/^\*(.+?)\*/);
    if (italic) { nodes.push(<em key={key++}>{italic[1]}</em>); rest = rest.slice(italic[0].length); continue; }
    const code = rest.match(/^`(.+?)`/);
    if (code) { nodes.push(<code key={key++} style={{ background: 'var(--surface3)', padding: '1px 5px', borderRadius: 3, fontSize: '0.88em' }}>{code[1]}</code>); rest = rest.slice(code[0].length); continue; }
    nodes.push(rest[0]);
    rest = rest.slice(1);
  }
  return nodes;
}

export default function MarkdownText({ children }: { children: string }) {
  if (!children) return null;
  const lines = children.split('\n');
  const out: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];

  const flushList = (idx: number) => {
    if (listItems.length > 0) {
      out.push(<ul key={`ul-${idx}`} style={{ paddingLeft: 18, margin: '4px 0' }}>{listItems}</ul>);
      listItems = [];
    }
  };

  lines.forEach((line, i) => {
    if (line.startsWith('### ')) {
      flushList(i);
      out.push(<h4 key={i} style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 700, margin: '8px 0 3px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{parseLine(line.slice(4))}</h4>);
    } else if (line.startsWith('## ')) {
      flushList(i);
      out.push(<h3 key={i} style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 700, margin: '8px 0 4px' }}>{parseLine(line.slice(3))}</h3>);
    } else if (line.startsWith('# ')) {
      flushList(i);
      out.push(<h2 key={i} style={{ color: 'var(--accent)', fontSize: 14, fontWeight: 700, margin: '8px 0 4px' }}>{parseLine(line.slice(2))}</h2>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      listItems.push(<li key={i}>{parseLine(line.slice(2))}</li>);
    } else if (line.trim() === '') {
      flushList(i);
      out.push(<div key={i} style={{ height: 6 }} />);
    } else {
      flushList(i);
      out.push(<p key={i} style={{ margin: '2px 0' }}>{parseLine(line)}</p>);
    }
  });
  flushList(lines.length);

  return (
    <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--text)' }}>
      {out}
    </div>
  );
}
