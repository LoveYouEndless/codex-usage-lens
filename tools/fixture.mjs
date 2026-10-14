export const sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
export const otherId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
export const sample = {
  session: {
    id: sessionId, model: 'example-model', provider: 'example-provider',
    total: { input: 185420, cached: 142600, output: 3218, reasoning: 1560, total: 188638 },
    context: 64380, window: 200000, updatedAt: '2026-10-14T06:12:00Z',
    turns: [
      {
        id: 'turn-1', messages: ['message-1'], model: 'example-model', complete: true,
        calls: 3, partial: false,
        usage: { input: 73600, cached: 58200, output: 1240, reasoning: 620, total: 74840 }
      },
      {
        id: 'turn-2', messages: ['message-2'], model: 'example-model', complete: true,
        calls: 5, partial: false,
        usage: { input: 111820, cached: 84400, output: 1978, reasoning: 940, total: 113798 }
      }
    ]
  }
};

export function fixtureHTML({ mobile = false, dark = false, language = 'en' } = {}) {
  return `<!doctype html><html lang="${language}" class="${dark ? 'dark' : ''}"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Codex Usage Lens demo</title>
    <style>
      *{box-sizing:border-box}body{margin:0;color:${dark ? '#ededed' : '#262626'};background:${dark ? '#191919' : '#fff'};
      font:14px/1.65 system-ui,sans-serif;letter-spacing:0}
      .layout{display:grid;grid-template-columns:210px minmax(0,1fr);min-height:100vh}
      aside{padding:22px 16px;background:${dark ? '#222' : '#f5f5f5'};border-right:1px solid ${dark ? '#333' : '#eee'}}
      aside header{font-size:15px;font-weight:600;margin-bottom:28px}
      .thread{display:block;border:0;width:100%;text-align:left;background:none;color:inherit;padding:9px;border-radius:5px;font:inherit}
      .thread[data-app-action-sidebar-thread-active=true]{background:${dark ? '#363636' : '#e7e7e7'}}
      main{padding:28px 38px 40px;min-width:0;max-width:930px}
      nav{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:34px}
      nav strong{font-size:15px}nav span{font-size:11px;color:${dark ? '#aaa' : '#777'}}
      .user{margin:20px 0 26px auto;width:fit-content;max-width:100%;background:${dark ? '#333' : '#f2f2f2'};padding:9px 14px;border-radius:7px}
      p{margin:0 0 16px}h2{font-size:15px;margin:0 0 10px}
      input{appearance:none;border:0;padding:0}
      .actions{display:flex;align-items:center;flex-wrap:wrap;gap:2px;min-height:26px;color:#888;font-size:11px}
      .native-buttons{display:flex;align-items:center;gap:13px;flex-shrink:0}
      .actions>span{margin-left:6px;flex-shrink:0}
      .actions button{background:none;border:0;padding:0;color:inherit;font:inherit}
      .reply{margin-bottom:22px}.composer{margin-top:32px;border:1px solid ${dark ? '#444' : '#dedede'};border-radius:8px;padding:16px;color:#999;height:88px}
      @media(max-width:600px){.layout{grid-template-columns:minmax(0,1fr)}aside{display:none}main{padding:20px 18px}
      nav{margin-bottom:20px;align-items:flex-start;flex-direction:column}.actions{gap:10px}}
    </style></head><body><div class="layout"><aside><header>Codex Usage Lens</header>
    <button class="thread" data-app-action-sidebar-thread-id="local:${sessionId}"
      data-app-action-sidebar-thread-active="true">Release checklist</button>
    <button class="thread" data-app-action-sidebar-thread-id="local:${otherId}"
      data-app-action-sidebar-thread-active="false">Parser cleanup</button></aside>
    <main><nav><strong>Release checklist</strong><span>Demo / synthetic data</span></nav>
    <div class="user">Can you check the release?</div>
    <section class="reply" data-response-annotation-conversation="${sessionId}" data-response-annotation-target="message-1">
      <h2>The checks passed.</h2><p>The parser handles interrupted writes and keeps cached input separate from the total.
      The package is ready for the next review.</p>
      <div class="actions"><div class="native-buttons"><button aria-label="Copy">Copy</button><button aria-label="Branch to new chat">Branch</button></div><span data-assistant-message-sent-time="true">14:10</span></div>
    </section>
    <div class="user">What changed in this turn?</div>
    <section class="reply" data-response-annotation-conversation="${sessionId}" data-response-annotation-target="message-2">
      <p>I checked the session boundaries, replayed the usage events, and verified the compact view at narrow widths.</p>
      <p>There are no duplicate counts when the same cumulative event appears twice.</p>
      <div class="actions"><div class="native-buttons"><button aria-label="Copy">Copy</button><button aria-label="Branch to new chat">Branch</button></div><span data-assistant-message-sent-time="true">14:12</span></div>
    </section>
    <div class="composer">Ask a follow-up</div></main></div></body></html>`;
}
