import { CDP, discover } from '../src/cdp.mjs';

const found = await discover();
const client = await CDP.connect(found.page.webSocketDebuggerUrl);
try {
  console.log(JSON.stringify(await client.evaluate(`(() => {
    const attributes = node => Object.fromEntries(Array.from(node.attributes || [])
      .filter(a => a.name.startsWith('data-') || a.name === 'role')
      .map(a => [a.name, a.value]));
    const nodes = Array.from(document.querySelectorAll(
      '[data-message-author-role="assistant"], [data-task-turn-id], [data-assistant-message], [data-assistant-message-sent-time]'
    )).slice(-8);
    return {
      href: location.href,
      active: Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-active="true"]')).map(attributes),
      messages: nodes.map(node => ({
        tag: node.tagName, attributes: attributes(node),
        parents: [node.parentElement, node.parentElement?.parentElement].filter(Boolean)
          .map(n => ({tag: n.tagName, attributes: attributes(n)})),
        descendants: Array.from(node.querySelectorAll('[data-message-id], [data-task-turn-id], [data-assistant-message-sent-time]')).slice(0, 8).map(attributes),
        buttonLabels: Array.from(node.querySelectorAll('button')).slice(-8).map(b => b.getAttribute('aria-label') || b.getAttribute('data-state'))
      }))
    };
  })()`), null, 2));
} finally { client.close(); }
