/** tau-override multi-session routing — appended to /app.js by proxy. */
export const INJECTED = `

// === tau-override: multi-session routing ===
(() => {
  let currentSessionFile = null;
  const bgQueues = new Map();

  function getSessionIdentity(sessionFile) {
    if (!sessionFile || typeof sessionFile !== 'string') return '';
    const normalized = sessionFile.replace(/\\\\/g, '/').replace(/^~\\//, '/');
    const marker = '/agent/sessions/';
    const markerIndex = normalized.indexOf(marker);
    if (markerIndex !== -1) return normalized.slice(markerIndex + marker.length);
    return normalized;
  }

  function sameSessionFile(leftSessionFile, rightSessionFile) {
    return getSessionIdentity(leftSessionFile) === getSessionIdentity(rightSessionFile);
  }

  function findSessionItem(sessionFile) {
    if (!sessionFile) return null;
    if (typeof document.querySelector === 'function') {
      const exactMatch = document.querySelector('.session-item[data-file-path="' + sessionFile.replace(/"/g, '&quot;') + '"]');
      if (exactMatch) return exactMatch;
    }
    if (typeof document.querySelectorAll !== 'function') return null;
    for (const item of document.querySelectorAll('.session-item')) {
      if (sameSessionFile(item?.dataset?.filePath, sessionFile)) return item;
    }
    return null;
  }

  function findSessionObject(sessionFile) {
    if (!sessionFile || !Array.isArray(sidebar.projects)) return null;
    for (const project of sidebar.projects) {
      if (!Array.isArray(project?.sessions)) continue;
      for (const session of project.sessions) {
        if (sameSessionFile(session?.filePath, sessionFile)) {
          return { session, project };
        }
      }
    }
    return null;
  }

  let pendingMirrorSyncFile = null;

  function syncActiveSessionForMirror(force) {
    if (!mirrorActiveSessionFile) return;
    if (!force) {
      const isTrackingMirrorSession = !currentSessionFile || sameSessionFile(currentSessionFile, mirrorActiveSessionFile);
      if (!isTrackingMirrorSession) return;
    }

    currentSessionFile = mirrorActiveSessionFile;
    const matchedSessionItem = findSessionItem(mirrorActiveSessionFile);
    if (matchedSessionItem?.dataset?.filePath) {
      currentSessionFile = matchedSessionItem.dataset.filePath;
    }
    if (typeof sidebar.setActive === 'function' && currentSessionFile) {
      sidebar.setActive(currentSessionFile);
    }

    if (force && typeof switchSession === 'function') {
      const found = findSessionObject(mirrorActiveSessionFile);
      if (found) {
        switchSession(currentSessionFile, found.session, found.project);
      } else {
        pendingMirrorSyncFile = mirrorActiveSessionFile;
      }
    }

    // Restore streaming element so that mid-stream message_update events
    // rendered by handleMirrorSync can be updated incrementally.
    if (typeof currentStreamingElement !== 'undefined' && !currentStreamingElement) {
      const streamingMsg = typeof document.querySelector === 'function'
        ? document.querySelector('.message.assistant .message-content.streaming')
        : null;
      if (streamingMsg) {
        currentStreamingElement = streamingMsg.closest('.message.assistant');
        // Reconstruct accumulated text from the DOM
        if (typeof currentStreamingText !== 'undefined') {
          const textNode = streamingMsg.querySelector('.streaming-text');
          if (textNode) currentStreamingText = textNode.textContent || '';
        }
        if (typeof currentStreamingThinking !== 'undefined') {
          const thinkingNode = streamingMsg.querySelector('.streaming-thinking .thinking-content');
          if (thinkingNode) currentStreamingThinking = thinkingNode.textContent || '';
        }
      }
    }
  }

  // Track which session the user is viewing via sidebar clicks
  sidebar.container.addEventListener('click', (e) => {
    const item = e.target.closest('.session-item');
    if (item) {
      currentSessionFile = item.dataset.filePath;
      if (mirrorActiveSessionFile && sameSessionFile(currentSessionFile, mirrorActiveSessionFile)) {
        currentSessionFile = mirrorActiveSessionFile;
      }
      flushBg(currentSessionFile);
    }
  });

  function filterOrEnqueue(ev) {
    const sf = ev.__sessionFile;
    if (!sf) return true;
    if (!currentSessionFile || sameSessionFile(sf, currentSessionFile)) return true;
    if (!bgQueues.has(sf)) bgQueues.set(sf, []);
    bgQueues.get(sf).push(ev);
    showBadge(sf);
    return false;
  }

  function flushBg(sf) {
    const queue = bgQueues.get(sf);
    if (!queue) return;
    bgQueues.delete(sf);
    hideBadge(sf);
    for (const ev of queue) handleRPCEvent(ev);
  }

  function showBadge(sf) {
    const item = findSessionItem(sf);
    if (!item) return;
    let badge = item.querySelector('.bg-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'bg-badge';
      item.querySelector('.session-title-row')?.appendChild(badge);
    }
    const count = (bgQueues.get(sf) || []).length;
    badge.textContent = count > 0 ? String(count) : '\u2022';
    item.classList.add('has-bg-activity');
  }

  function hideBadge(sf) {
    const item = findSessionItem(sf);
    if (!item) return;
    const badge = item.querySelector('.bg-badge');
    if (badge) badge.remove();
    item.classList.remove('has-bg-activity');
  }

  let sidebarRefreshPromise = null;
  let sidebarRefreshQueued = false;

  function alignKnownSessionFilePaths() {
    if (!Array.isArray(sidebar.projects)) return;
    if (!mirrorActiveSessionFile) return;
    for (const project of sidebar.projects) {
      if (!Array.isArray(project?.sessions)) continue;
      for (const session of project.sessions) {
        if (sameSessionFile(session?.filePath, mirrorActiveSessionFile)) {
          session.filePath = mirrorActiveSessionFile;
        }
      }
    }
    if (typeof document.querySelectorAll === 'function') {
      for (const item of document.querySelectorAll('.session-item')) {
        if (sameSessionFile(item?.dataset?.filePath, mirrorActiveSessionFile)) {
          item.dataset.filePath = mirrorActiveSessionFile;
        }
      }
    }
    if (currentSessionFile && sameSessionFile(currentSessionFile, mirrorActiveSessionFile)) {
      currentSessionFile = mirrorActiveSessionFile;
    }
  }

  function patchSessionSwitchForMirrorPaths() {
    if (typeof switchSession !== 'function') return;
    if (switchSession.__tauMirrorPatched) return;
    const originalSwitchSession = switchSession;
    const patchedSwitchSession = async function (sessionFile, session, project) {
      if (isMirrorMode && mirrorActiveSessionFile && sameSessionFile(sessionFile, mirrorActiveSessionFile)) {
        sessionFile = mirrorActiveSessionFile;
        if (session && typeof session === 'object') session.filePath = mirrorActiveSessionFile;
      }
      return originalSwitchSession(sessionFile, session, project);
    };
    patchedSwitchSession.__tauMirrorPatched = true;
    switchSession = patchedSwitchSession;
  }

  function reloadSidebar() {
    if (sidebarRefreshPromise) {
      sidebarRefreshQueued = true;
      return sidebarRefreshPromise;
    }

    sidebarRefreshPromise = sidebar.loadSessions().then(() => {
      alignKnownSessionFilePaths();
      patchSessionSwitchForMirrorPaths();
      syncActiveSessionForMirror();
    }).finally(() => {
      const shouldReloadAgain = sidebarRefreshQueued;
      sidebarRefreshQueued = false;
      sidebarRefreshPromise = null;
      if (typeof updateMirrorLiveIndicator === 'function') updateMirrorLiveIndicator();
      if (currentSessionFile) flushBg(currentSessionFile);
      if (pendingMirrorSyncFile && sameSessionFile(pendingMirrorSyncFile, mirrorActiveSessionFile)) {
        const found = findSessionObject(mirrorActiveSessionFile);
        if (found && typeof switchSession === 'function') {
          currentSessionFile = found.session.filePath || mirrorActiveSessionFile;
          if (typeof sidebar.setActive === 'function') sidebar.setActive(currentSessionFile);
          switchSession(currentSessionFile, found.session, found.project);
          flushBg(currentSessionFile);
        }
        pendingMirrorSyncFile = null;
      }
      if (shouldReloadAgain) reloadSidebar();
    });

    return sidebarRefreshPromise;
  }

  function patchStreamingMessageRendering() {
    if (typeof messageRenderer === 'undefined') return;
    if (!messageRenderer || typeof messageRenderer.updateStreamingMessage !== 'function') return;
    if (messageRenderer.__tauMirrorStreamingPatched) return;

    messageRenderer.updateStreamingMessage = function (messageElement, content) {
      const contentDiv = messageElement.querySelector('.message-content');
      if (!contentDiv) return;

      let streamingTextNode = contentDiv.querySelector('.streaming-text');
      if (!streamingTextNode) {
        // When a history message is repurposed as the streaming target
        // (after handleMirrorSync clears DOM), clear any pre-rendered
        // markdown/HTML so only the streaming-text node remains
        // alongside any thinking block.
        const thinkingBlock = contentDiv.querySelector('.streaming-thinking, .thinking-block');
        if (thinkingBlock) {
          contentDiv.innerHTML = '';
          contentDiv.appendChild(thinkingBlock);
        } else {
          contentDiv.innerHTML = '';
        }
        streamingTextNode = document.createElement('div');
        streamingTextNode.className = 'streaming-text';
        contentDiv.appendChild(streamingTextNode);
      }

      if (typeof messageRenderer.escapeHtml === 'function') {
        streamingTextNode.innerHTML = messageRenderer.escapeHtml(content);
      } else {
        streamingTextNode.textContent = content;
      }

      if (typeof messageRenderer.scrollToBottom === 'function') {
        messageRenderer.scrollToBottom();
      }
    };

    if (typeof messageRenderer.finalizeStreamingMessage === 'function') {
      const origFinalize = messageRenderer.finalizeStreamingMessage.bind(messageRenderer);
      messageRenderer.finalizeStreamingMessage = function (messageElement, usage, thinking) {
        const contentDiv = messageElement.querySelector('.message-content');
        if (contentDiv && !contentDiv.querySelector('.streaming-text')) {
          const st = document.createElement('div');
          st.className = 'streaming-text';
          contentDiv.appendChild(st);
        }
        return origFinalize(messageElement, usage, thinking);
      };
    }

    if (typeof messageRenderer.clear === 'function' && !messageRenderer.clear.__tauMirrorClearPatched) {
      const origClear = messageRenderer.clear.bind(messageRenderer);
      messageRenderer.clear = function () {
        currentStreamingElement = null;
        currentStreamingText = '';
        currentStreamingThinking = '';
        return origClear();
      };
      messageRenderer.clear.__tauMirrorClearPatched = true;
    }

    messageRenderer.__tauMirrorStreamingPatched = true;
  }

  patchSessionSwitchForMirrorPaths();
  patchStreamingMessageRendering();

  // Guard handleMirrorSync: when tau-mirror's global latestCtx points to a
  // different session (e.g. squad sub-session vs parent session), a plain
  // mirror_sync would clear the DOM and render the wrong history, wiping
  // out any live thinking from the session the user is actually viewing.
  // We drop non-matching non-forced mirror_sync; forced ones still switch.
  if (typeof handleMirrorSync === 'function' && !handleMirrorSync.__tauMirrorSyncGuard) {
    const origHandleMirrorSync = handleMirrorSync;
    handleMirrorSync = function (data) {
      if (
        data.sessionFile &&
        currentSessionFile &&
        !sameSessionFile(data.sessionFile, currentSessionFile) &&
        !data.forced
      ) {
        isMirrorMode = true;
        mirrorActiveSessionFile = data.sessionFile || null;
        if (typeof updateMirrorLiveIndicator === 'function') updateMirrorLiveIndicator();
        return;
      }
      const result = origHandleMirrorSync(data);

      // After mirror_sync clears DOM and re-renders history, the
      // currentStreamingElement points to a detached orphan node.
      // If the backend is still streaming, reconnect to the last
      // assistant message in the DOM so subsequent message_update
      // events (thinking_delta / text_delta) update visible DOM.
      if (data.isStreaming) {
        const container = typeof messagesContainer !== 'undefined' ? messagesContainer : document.getElementById('messages');
        const allAssistants = container ? container.querySelectorAll('.message.assistant') : [];
        const lastAssistant = allAssistants.length > 0 ? allAssistants[allAssistants.length - 1] : null;
        if (lastAssistant) {
          currentStreamingElement = lastAssistant;
          const contentDiv = lastAssistant.querySelector('.message-content');
          if (contentDiv && !contentDiv.classList.contains('streaming')) {
            contentDiv.classList.add('streaming');
          }

          // Convert any existing static thinking block to streaming-thinking
          // so updateStreamingThinking finds it instead of creating a duplicate.
          const thinkingBlock = contentDiv?.querySelector('.thinking-block:not(.streaming-thinking)');
          if (thinkingBlock) {
            thinkingBlock.classList.add('streaming-thinking');
            thinkingBlock.querySelector('.thinking-toggle')?.classList.add('expanded');
            thinkingBlock.querySelector('.thinking-content')?.classList.add('expanded');
          }

          // Sync accumulated text state from DOM so deltas append correctly.
          const streamingText = contentDiv?.querySelector('.streaming-text');
          if (streamingText) {
            currentStreamingText = streamingText.textContent || '';
          } else {
            const clone = contentDiv?.cloneNode(true);
            if (clone) {
              clone.querySelector('.thinking-block')?.remove();
              currentStreamingText = clone.textContent || '';
            }
          }

          // Sync accumulated thinking state from DOM.
          const thinkingContent = contentDiv?.querySelector('.thinking-block .thinking-content, .streaming-thinking .thinking-content');
          if (thinkingContent) {
            currentStreamingThinking = thinkingContent.textContent || '';
          }
        }
      } else {
        currentStreamingElement = null;
        currentStreamingText = '';
        currentStreamingThinking = '';
      }

      return result;
    };
    handleMirrorSync.__tauMirrorSyncGuard = true;
  }

  // When a subagent's streaming event arrives (via squad:subagent:stream)
  // and the browser never saw a message_start (e.g. user switched to the
  // sub-session mid-stream), currentStreamingElement is null and the
  // update is silently lost.  Reconnect to the last assistant message in
  // the DOM so the delta has a visible target.
  if (typeof handleMessageUpdate === 'function' && !handleMessageUpdate.__tauMirrorReconnectPatched) {
    const origHandleMessageUpdate = handleMessageUpdate;
    handleMessageUpdate = function (event) {
      const el = currentStreamingElement;
      const isOrphan = el && typeof document !== 'undefined' && !document.contains(el);
      if ((!el || isOrphan) && event.assistantMessageEvent) {
        const container = typeof messagesContainer !== 'undefined' ? messagesContainer : document.getElementById('messages');
        const allAssistants = container ? container.querySelectorAll('.message.assistant') : [];
        const lastAssistant = allAssistants.length > 0 ? allAssistants[allAssistants.length - 1] : null;
        if (lastAssistant) {
          currentStreamingElement = lastAssistant;
          const contentDiv = lastAssistant.querySelector('.message-content');
          if (contentDiv && !contentDiv.classList.contains('streaming')) {
            contentDiv.classList.add('streaming');
          }

          // Convert existing static thinking block to streaming-thinking
          const thinkingBlock = contentDiv?.querySelector('.thinking-block:not(.streaming-thinking)');
          if (thinkingBlock) {
            thinkingBlock.classList.add('streaming-thinking');
            thinkingBlock.querySelector('.thinking-toggle')?.classList.add('expanded');
            thinkingBlock.querySelector('.thinking-content')?.classList.add('expanded');
          }

          // Sync text state from DOM
          const streamingText = contentDiv?.querySelector('.streaming-text');
          if (streamingText) {
            currentStreamingText = streamingText.textContent || '';
          } else {
            const clone = contentDiv?.cloneNode(true);
            if (clone) {
              clone.querySelector('.thinking-block')?.remove();
              currentStreamingText = clone.textContent || '';
            }
          }

          // Sync thinking state from DOM
          const thinkingContent = contentDiv?.querySelector('.thinking-block .thinking-content, .streaming-thinking .thinking-content');
          if (thinkingContent) {
            currentStreamingThinking = thinkingContent.textContent || '';
          }
        }
      }
      return origHandleMessageUpdate(event);
    };
    handleMessageUpdate.__tauMirrorReconnectPatched = true;
  }

  // Intercept handleMessage instead of onmessage to avoid double JSON.parse
  if (typeof wsClient.handleMessage === 'function') {
    const origHandleMessage = wsClient.handleMessage.bind(wsClient);
    wsClient.handleMessage = function (msg) {
      if (msg.type === 'event' && msg.event?.type === 'session_catalog_changed') {
        reloadSidebar();
        return;
      }
      if (msg.type === 'event' && msg.event?.__sessionFile) {
        if (!filterOrEnqueue(msg.event)) return;
      }
      const handled = origHandleMessage(msg);
      if (msg.type === 'mirror_sync') {
        alignKnownSessionFilePaths();
        syncActiveSessionForMirror(msg.forced === true);
      }
      return handled;
    };
  }

  const style = document.createElement('style');
  style.textContent = '.bg-badge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#e74c3c;color:#fff;font-size:11px;font-weight:700;margin-left:auto}.session-item.has-bg-activity .session-title{color:#e74c3c}';
  document.head.appendChild(style);
})();
`;
