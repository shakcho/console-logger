// Tiny token highlighter — emits HTML strings with classes that match
// VitePress design tokens defined in custom.css (.demo-tok-*).

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const wrap = (cls: string, text: string) =>
  `<span class="demo-tok-${cls}">${escape(text)}</span>`;

export function highlightCode(code: string): string {
  return code
    .split('\n')
    .map((line) => {
      let rest = line;
      let out = '';

      while (rest.length > 0) {
        let m: RegExpMatchArray | null;

        if ((m = rest.match(/^(\/\/.*)/))) {
          out += wrap('comment', m[1]);
          rest = rest.slice(m[1].length);
          continue;
        }
        if ((m = rest.match(/^(<\/?[a-zA-Z][a-zA-Z0-9-]*)/))) {
          out += wrap('tag', m[1]);
          rest = rest.slice(m[1].length);
          continue;
        }
        if ((m = rest.match(/^('[^']*'|"[^"]*"|`[^`]*`)/))) {
          out += wrap('string', m[1]);
          rest = rest.slice(m[1].length);
          continue;
        }
        if ((m = rest.match(/^(\b\d+\.?\d*\b)/))) {
          out += wrap('number', m[1]);
          rest = rest.slice(m[1].length);
          continue;
        }
        if ((m = rest.match(/^(\b(?:true|false|null|undefined)\b)/))) {
          out += wrap('boolean', m[1]);
          rest = rest.slice(m[1].length);
          continue;
        }
        if (
          (m = rest.match(
            /^(\b(?:import|from|export|const|let|var|function|return|if|else|new|await|async|for|of|in|class|extends|type|interface|process|window|document|app)\b)/,
          ))
        ) {
          out += wrap('keyword', m[1]);
          rest = rest.slice(m[1].length);
          continue;
        }
        if ((m = rest.match(/^(=>)/))) {
          out += wrap('keyword', '=>');
          rest = rest.slice(2);
          continue;
        }
        if ((m = rest.match(/^([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)(\s*\()/))) {
          const parts = m[1].split('.');
          parts.forEach((part, i) => {
            if (i > 0) out += '.';
            if (i === parts.length - 1) out += wrap('func', part);
            else out += escape(part);
          });
          out += escape(m[2]);
          rest = rest.slice(m[0].length);
          continue;
        }
        if ((m = rest.match(/^([a-zA-Z_$][\w$]*)(\s*[:=])/))) {
          out += wrap('attr', m[1]);
          out += escape(m[2]);
          rest = rest.slice(m[0].length);
          continue;
        }

        out += escape(rest[0]);
        rest = rest.slice(1);
      }

      return out;
    })
    .join('\n');
}
