import { PromptWidgetElement } from './widget.js';

declare global {
  interface Window {
    promptWidget: PromptWidgetElement;
  }
}

const widget = new PromptWidgetElement();
window.promptWidget = widget;

export { PromptWidgetElement };
