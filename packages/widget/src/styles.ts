export const WIDGET_CSS = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #e2e8f0;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.pw-trigger {
  position: fixed;
  z-index: 2147483647;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #6366f1;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
  transition: transform 0.2s, box-shadow 0.2s;
}

.pw-trigger:hover {
  transform: scale(1.1);
  box-shadow: 0 6px 16px rgba(99, 102, 241, 0.5);
}

.pw-trigger svg {
  width: 24px;
  height: 24px;
  fill: white;
}

.pw-trigger.bottom-right { bottom: 20px; right: 20px; }
.pw-trigger.bottom-left { bottom: 20px; left: 20px; }
.pw-trigger.top-right { top: 20px; right: 20px; }
.pw-trigger.top-left { top: 20px; left: 20px; }

.pw-panel {
  position: fixed;
  z-index: 2147483647;
  width: 360px;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(99, 102, 241, 0.08);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: pw-slide-in 0.2s ease-out;
}

.pw-panel.bottom-right { bottom: 80px; right: 20px; }
.pw-panel.bottom-left { bottom: 80px; left: 20px; }
.pw-panel.top-right { top: 80px; right: 20px; }
.pw-panel.top-left { top: 80px; left: 20px; }

@keyframes pw-slide-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.pw-close {
  position: absolute;
  top: 4px;
  right: 4px;
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
}

.pw-close:hover {
  color: #e2e8f0;
  background: rgba(255,255,255,0.1);
}

.pw-screenshots {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding: 8px 10px 0;
}

.pw-screenshot-wrap {
  position: relative;
  width: 40px;
  height: 40px;
}

.pw-screenshot-thumb {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  object-fit: cover;
  border: 1px solid #334155;
  cursor: pointer;
}

.pw-screenshot-thumb:hover {
  border-color: #6366f1;
}

.pw-screenshot-remove {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #dc2626;
  color: white;
  border: 1px solid #1e293b;
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.pw-screenshot-remove:hover {
  background: #b91c1c;
}

.pw-input-area {
  padding: 10px;
}

.pw-textarea {
  width: 100%;
  min-height: 60px;
  max-height: 150px;
  padding: 10px 12px;
  border: 1px solid #334155;
  border-radius: 8px;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.5;
  outline: none;
  resize: vertical;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.pw-textarea::placeholder {
  color: #64748b;
}

.pw-textarea:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15);
}

.pw-context-options {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 8px;
}

.pw-check {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font-size: 11px;
  color: #94a3b8;
  user-select: none;
  transition: color 0.15s;
}

.pw-check:hover {
  color: #cbd5e1;
}

.pw-check input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border: 1px solid #475569;
  border-radius: 3px;
  background: #0f172a;
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
  transition: background 0.15s, border-color 0.15s;
}

.pw-check input[type="checkbox"]:checked {
  background: #6366f1;
  border-color: #6366f1;
}

.pw-check input[type="checkbox"]:checked::after {
  content: '';
  position: absolute;
  top: 1px;
  left: 4px;
  width: 4px;
  height: 7px;
  border: solid white;
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(45deg);
}

.pw-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

.pw-camera-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: none;
  background: #334155;
  color: #94a3b8;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}

.pw-camera-btn:hover {
  background: #475569;
  color: #e2e8f0;
}

.pw-camera-btn svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
}

.pw-picker-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: none;
  background: #334155;
  color: #94a3b8;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}

.pw-picker-btn:hover {
  background: #475569;
  color: #e2e8f0;
}

.pw-picker-btn svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
}

.pw-selected-element {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 10px 0;
  padding: 4px 8px;
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid #6366f1;
  border-radius: 6px;
  font-size: 12px;
}

.pw-selected-element code {
  font-family: monospace;
  color: #c7d2fe;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pw-selected-element-remove {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: rgba(255,255,255,0.1);
  color: #94a3b8;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.pw-selected-element-remove:hover {
  background: rgba(255,255,255,0.2);
  color: #e2e8f0;
}

.pw-send-btn {
  height: 32px;
  padding: 0 14px;
  border-radius: 6px;
  border: none;
  background: #6366f1;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 13px;
  font-family: inherit;
  font-weight: 500;
  transition: background 0.15s, transform 0.1s;
}

.pw-send-btn:hover {
  background: #4f46e5;
}

.pw-send-btn:active {
  transform: scale(0.97);
}

.pw-send-btn svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
}

.pw-flash {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #22c55e;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.pw-flash svg {
  width: 28px;
  height: 28px;
  fill: #22c55e;
}

.pw-error {
  padding: 4px 10px 8px;
  color: #f87171;
  font-size: 12px;
}

.pw-hidden {
  display: none !important;
}

.pw-annotator {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  animation: pw-slide-in 0.15s ease-out;
}

.pw-annotator-toolbar {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.pw-annotator-toolbar button {
  height: 32px;
  padding: 0 14px;
  border-radius: 6px;
  border: 1px solid #475569;
  background: #1e293b;
  color: #e2e8f0;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  transition: background 0.15s, border-color 0.15s;
}

.pw-annotator-toolbar button:hover {
  background: #334155;
  border-color: #6366f1;
}

.pw-annotator-toolbar button.active {
  background: #6366f1;
  border-color: #6366f1;
}

.pw-annotator-toolbar button.pw-annotator-save {
  background: #6366f1;
  border-color: #6366f1;
}

.pw-annotator-toolbar button.pw-annotator-save:hover {
  background: #4f46e5;
}

.pw-annotator-canvas-wrap {
  position: relative;
  max-width: 90vw;
  max-height: calc(100vh - 100px);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.pw-annotator-canvas-wrap img {
  display: block;
  max-width: 90vw;
  max-height: calc(100vh - 100px);
  object-fit: contain;
}

.pw-annotator-canvas-wrap canvas {
  position: absolute;
  top: 0;
  left: 0;
  cursor: crosshair;
}

.pw-annotator-hint {
  margin-top: 10px;
  font-size: 12px;
  color: #64748b;
}

.pw-admin-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: none;
  background: #334155;
  color: #94a3b8;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}

.pw-admin-btn:hover {
  background: #475569;
  color: #e2e8f0;
}

.pw-admin-btn svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
}

.pw-admin-options {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 10px 2px;
  border-top: 1px solid #334155;
  animation: pw-slide-in 0.12s ease-out;
}

.pw-admin-option {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid #334155;
  border-radius: 6px;
  background: #0f172a;
  color: #cbd5e1;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s;
}

.pw-admin-option:hover {
  background: #334155;
  border-color: #6366f1;
  color: #f1f5f9;
}

.pw-admin-option-icon {
  font-size: 13px;
}

.pw-session-id-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 8px;
  font-size: 11px;
  color: #94a3b8;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s;
}

.pw-session-id-row:hover {
  background: #334155;
}

.pw-session-id-label {
  flex-shrink: 0;
}

.pw-session-id-value {
  font-family: monospace;
  font-size: 10px;
  color: #cbd5e1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`;
