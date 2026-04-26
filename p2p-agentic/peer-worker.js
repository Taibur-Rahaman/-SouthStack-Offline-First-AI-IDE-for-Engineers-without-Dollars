/**
 * P2P Agentic Peer Worker
 * 
 * Runs on each browser/laptop:
 * - Connects to coordinator
 * - Listens for task assignments
 * - Executes coding tasks locally (WebGPU LLM)
 * - Reports results back to coordinator
 */

import { initializeEngine, ask } from '../southstack-p2p/main.js';

class P2PAgenticPeerWorker {
  constructor(config = {}) {
    this.peerId = this.generateId();
    this.coordinatorChannel = null;
    this.capabilities = null;
    this.activeTasks = new Map(); // taskId -> state
    
    this.config = {
      model: config.model || 'Qwen2.5-Coder-1.5B-Instruct-q4f32_1',
      maxConcurrentTasks: config.maxConcurrentTasks || 1,
      announceInterval: config.announceInterval || 10000,
      ...config
    };
    
    console.log(`[P2P Peer Worker] Started (ID: ${this.peerId})`);
  }

  /**
   * Initialize peer and detect capabilities
   */
  async initialize() {
    try {
      // Detect hardware capabilities
      this.capabilities = await this.detectCapabilities();
      console.log(`[P2P Worker] Capabilities:`, this.capabilities);
      
      // Initialize LLM engine
      await initializeEngine(this.config.model);
      console.log(`[P2P Worker] LLM engine ready`);
      
      // Setup WebRTC signaling channel
      this.setupSignaling();
      
      // Start announcing to coordinator
      this.startAnnouncement();
      
      return true;
    } catch (e) {
      console.error(`[P2P Worker] Initialization failed:`, e);
      return false;
    }
  }

  /**
   * Detect this device's capabilities
   */
  async detectCapabilities() {
    const capabilities = {
      webgpu: this.hasWebGPU(),
      ram: navigator.deviceMemory || 4,
      gpu: await this.getGPUInfo(),
      storage: await this.getStorageAvailable(),
      bandwidth: await this.estimateBandwidth(),
      cpuCores: navigator.hardwareConcurrency || 1
    };
    
    return capabilities;
  }

  hasWebGPU() {
    return navigator.gpu ? true : false;
  }

  async getGPUInfo() {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      const info = await adapter.requestAdapterInfo();
      return {
        vendor: info.vendor || 'unknown',
        device: info.device || 'unknown'
      };
    } catch (e) {
      return { vendor: 'unknown', device: 'unknown' };
    }
  }

  async getStorageAvailable() {
    try {
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        return {
          available: estimate.quota || 0,
          used: estimate.usage || 0,
          percent: Math.round((estimate.usage / estimate.quota) * 100)
        };
      }
    } catch (e) {}
    return { available: 0, used: 0, percent: 0 };
  }

  async estimateBandwidth() {
    // Simple heuristic based on connection
    const connection = navigator.connection || {};
    return {
      effectiveType: connection.effectiveType || '4g',
      downlink: connection.downlink || 5,
      rtt: connection.rtt || 50
    };
  }

  /**
   * Setup WebRTC signaling channel
   */
  setupSignaling() {
    // In real app, connect to relay server or coordinator
    window.addEventListener('message', (e) => {
      if (e.data.type === 'COORDINATOR_MSG') {
        this.handleCoordinatorMessage(e.data.payload);
      }
    });
    
    console.log(`[P2P Worker] Signaling ready`);
  }

  /**
   * Announce availability to coordinator
   */
  startAnnouncement() {
    const announcement = {
      type: 'PEER_ANNOUNCE',
      peerId: this.peerId,
      capabilities: this.capabilities,
      timestamp: Date.now()
    };
    
    // Send to coordinator (via relay or direct)
    this.sendToCoordinator(announcement);
    
    // Repeat periodically
    setInterval(() => {
      announcement.timestamp = Date.now();
      this.sendToCoordinator(announcement);
    }, this.config.announceInterval);
  }

  /**
   * Send message to coordinator
   */
  sendToCoordinator(message) {
    if (this.coordinatorChannel && this.coordinatorChannel.readyState === 'open') {
      this.coordinatorChannel.send(JSON.stringify(message));
    } else {
      // Post to coordinator iframe or parent window
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'TO_COORDINATOR',
          payload: message
        }, '*');
      }
    }
  }

  /**
   * Handle message from coordinator
   */
  async handleCoordinatorMessage(payload) {
    const { type, taskId, subtaskId, prompt, model } = payload;
    
    switch (type) {
      case 'TASK_ASSIGN':
        await this.executeTask(taskId, subtaskId, prompt, model);
        break;
      
      case 'TASK_CANCEL':
        this.cancelTask(taskId);
        break;
      
      case 'PING':
        this.respondPing();
        break;
      
      default:
        console.warn(`[P2P Worker] Unknown message type:`, type);
    }
  }

  /**
   * Execute coding task via local LLM
   */
  async executeTask(taskId, subtaskId, prompt, model) {
    const assignmentId = `${taskId}_${subtaskId}`;
    
    console.log(`[P2P Worker] Executing task: ${assignmentId}`);
    console.log(`   Prompt: ${prompt.substring(0, 100)}...`);
    
    const startTime = Date.now();
    
    // Track active task
    const taskState = {
      taskId,
      subtaskId,
      prompt,
      status: 'running',
      startTime,
      result: null
    };
    
    this.activeTasks.set(assignmentId, taskState);
    
    try {
      // Run LLM inference
      let fullResponse = '';
      let tokenCount = 0;
      
      // Use window.ask from southstack-p2p
      const stream = await ask(prompt);
      
      for await (const token of stream) {
        fullResponse += token;
        tokenCount++;
        
        // Report progress back to coordinator
        this.reportProgress(taskId, subtaskId, {
          tokens: tokenCount,
          preview: fullResponse.substring(0, 100)
        });
      }
      
      // Task complete
      const duration = Date.now() - startTime;
      const result = {
        response: fullResponse,
        tokens: tokenCount,
        duration: duration,
        model: model,
        peer: this.peerId
      };
      
      taskState.status = 'completed';
      taskState.result = result;
      
      // Send result to coordinator
      this.reportResult(taskId, subtaskId, result);
      
      console.log(`[P2P Worker] Task completed in ${duration}ms`);
      
    } catch (e) {
      console.error(`[P2P Worker] Task error:`, e);
      
      taskState.status = 'error';
      taskState.error = e.message;
      
      this.reportError(taskId, subtaskId, e.message);
    }
    
    this.activeTasks.delete(assignmentId);
  }

  /**
   * Report task progress to coordinator
   */
  reportProgress(taskId, subtaskId, progress) {
    this.sendToCoordinator({
      type: 'TASK_PROGRESS',
      taskId,
      subtaskId,
      peerId: this.peerId,
      progress,
      timestamp: Date.now()
    });
  }

  /**
   * Report completed result to coordinator
   */
  reportResult(taskId, subtaskId, result) {
    this.sendToCoordinator({
      type: 'TASK_RESULT',
      taskId,
      subtaskId,
      peerId: this.peerId,
      result,
      timestamp: Date.now()
    });
    
    console.log(`[P2P Worker] Result reported for ${taskId}_${subtaskId}`);
  }

  /**
   * Report error to coordinator
   */
  reportError(taskId, subtaskId, error) {
    this.sendToCoordinator({
      type: 'TASK_ERROR',
      taskId,
      subtaskId,
      peerId: this.peerId,
      error,
      timestamp: Date.now()
    });
  }

  /**
   * Cancel task in progress
   */
  cancelTask(taskId) {
    console.log(`[P2P Worker] Canceling task: ${taskId}`);
    
    for (const [assignmentId, taskState] of this.activeTasks) {
      if (taskState.taskId === taskId) {
        taskState.status = 'cancelled';
        // In real impl, would abort LLM inference
      }
    }
  }

  /**
   * Respond to ping (health check)
   */
  respondPing() {
    this.sendToCoordinator({
      type: 'PONG',
      peerId: this.peerId,
      activeTasks: this.activeTasks.size,
      timestamp: Date.now()
    });
  }

  /**
   * Get peer status
   */
  getStatus() {
    return {
      peerId: this.peerId,
      capabilities: this.capabilities,
      activeTasks: Array.from(this.activeTasks.values()),
      status: this.activeTasks.size > 0 ? 'working' : 'idle'
    };
  }

  // Utilities
  generateId() {
    return `peer_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export { P2PAgenticPeerWorker };
