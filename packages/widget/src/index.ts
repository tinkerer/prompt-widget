import { PromptWidgetElement } from './widget.js';

declare global {
  interface Window {
    promptWidget: PromptWidgetElement;
  }
}

const script = document.currentScript || document.querySelector('script[data-endpoint]');
const noEmbed = script instanceof HTMLScriptElement && script.dataset.noEmbed === 'true';
const inEmbedIframe = window !== window.top && new URLSearchParams(window.location.search).get('embed') === 'true';

if (!noEmbed || !inEmbedIframe) {
  const widget = new PromptWidgetElement();
  window.promptWidget = widget;
}

export { PromptWidgetElement };
