/**
 * P2P Agentic Coordinator
 * 
 * Orchestrates multiple browser peers to:
 * - Share computational tasks
 * - Distribute inference across devices
 * - Load balance based on hardware capabilities
 * - Aggregate results from multiple peers
 * 
 * Architecture:
 * Peer 1 (Laptop) ──┐
 * Peer 2 (Laptop) ──├──> Coordinator ──> Task Queue
 * Peer 3 (Laptop) ──┘
 * 
 * Each peer runs:
 * - WebGPU LLM inference (local)
 * - P2P signaling (WebRTC)
 * - Task executor (agentic)
 */

class P2PAgenticCoordinator {
  constructor(config = {}) {
    this.peers = new Map(); // peerId -> {capabilities, status, channel}
    this.taskQueue = []; // pending tasks
    this.taskAssignments = new Map(); // taskId -> {peer, progress}
    this.results = new Map(); // taskId -> result
    
    this.config = {
      maxConcurrentTasks: config.maxConcurrentTasks || 3,
      taskTimeout: config.taskTimeout || 300000, // 5 min
      heartbeatInterval: config.heartbeatInterval || 5000,
      agentModel: config.agentModel || 'Qwen2.5-Coder-1.5B-Instruct-q4f32_1',
      ...config
    };
    
    this.agentId = this.generateId();
    this.taskIdCounter = 0;
    this.setupHeartbeat();
    
    console.log(`[P2P Coordinator] Started (ID: ${this.agentId})`);
  }

  /**
   * Register a peer device (laptop/browser)
   * Called when new peer connects
   */
  registerPeer(peerId, capabilities) {
    const peer = {
      id: peerId,
      capabilities: capabilities, // { webgpu, ram, gpu, storage }
      status: 'idle', // idle | working | error
      activeTasks: 0,
      completedTasks: 0,
      lastHeartbeat: Date.now(),
      channel: null
    };
    
    this.peers.set(peerId, peer);
    console.log(`[P2P] Peer registered: ${peerId}`, capabilities);
    
    return peer;
  }

  /**
   * Main API: Distribute coding task across peers
   * 
   * Example:
   * coordinator.executeDistributedTask({
   *   prompt: "Implement a sorting algorithm",
   *   subtasks: [
   *     "Create quicksort function",
   *     "Create mergesort function", 
   *     "Write unit tests"
   *   ]
   * })
   */
  async executeDistributedTask(taskDef) {
    const taskId = `task_${++this.taskIdCounter}_${Date.now()}`;
    
    console.log(`[P2P] New distributed task: ${taskId}`);
    console.log(`   Prompt: ${taskDef.prompt}`);
    console.log(`   Subtasks: ${taskDef.subtasks.length}`);
    
    // Break into subtasks for parallel processing
    const subtasks = this.createSubtasks(taskDef);
    
    // Add to queue
    const queuedTask = {
      id: taskId,
      parentPrompt: taskDef.prompt,
      subtasks: subtasks,
      createdAt: Date.now(),
      status: 'queued',
      results: {}
    };
    
    this.taskQueue.push(queuedTask);
    
    // Try to schedule immediately
    this.scheduleNextTasks();
    
    return taskId;
  }

  /**
   * Break single task into parallel subtasks
   */
  createSubtasks(taskDef) {
    const subtasks = [];
    
    // Use provided subtasks or auto-generate
    if (taskDef.subtasks && Array.isArray(taskDef.subtasks)) {
      subtasks.push(...taskDef.subtasks.map((desc, idx) => ({
        id: `sub_${idx}`,
        description: desc,
        prompt: desc,
        type: 'parallel',
        priority: idx
      })));
    } else {
      // Auto-decompose large task
      subtasks.push({
        id: 'sub_0',
        description: 'Full task',
        prompt: taskDef.prompt,
        type: 'sequential',
        priority: 0
      });
    }
    
    return subtasks;
  }

  /**
   * Assign tasks to available peers
   */
  scheduleNextTasks() {
    const availablePeers = Array.from(this.peers.values()).filter(p => 
      p.status === 'idle' && p.activeTasks < 1
    );
    
    if (availablePeers.length === 0) return;
    
    const queuedTasks = this.taskQueue.filter(t => t.status === 'queued');
    if (queuedTasks.length === 0) return;
    
    // Pair subtasks with peers
    for (let i = 0; i < availablePeers.length && queuedTasks.length > 0; i++) {
      const peer = availablePeers[i];
      const task = queuedTasks[0];
      
      const unassignedSubtask = task.subtasks.find(st => 
        !this.taskAssignments.has(`${task.id}_${st.id}`)
      );
      
      if (unassignedSubtask) {
        this.assignTaskToPeer(task, unassignedSubtask, peer);
      }
    }
  }

  /**
   * Assign specific subtask to peer
   */
  assignTaskToPeer(parentTask, subtask, peer) {
    const assignmentId = `${parentTask.id}_${subtask.id}`;
    
    const assignment = {
      taskId: parentTask.id,
      subtaskId: subtask.id,
      peerId: peer.id,
      assignedAt: Date.now(),
      status: 'assigned',
      prompt: subtask.prompt,
      result: null
    };
    
    this.taskAssignments.set(assignmentId, assignment);
    peer.status = 'working';
    peer.activeTasks++;
    
    // Send to peer via WebRTC channel
    this.sendTaskToPeer(peer, assignment);
    
    console.log(`[P2P] Assigned to ${peer.id}: ${subtask.description}`);
    
    return assignmentId;
  }

  /**
   * Send task to peer (via WebRTC DataChannel)
   */
  sendTaskToPeer(peer, assignment) {
    if (!peer.channel || peer.channel.readyState !== 'open') {
      console.warn(`[P2P] Channel not ready for ${peer.id}`);
      return;
    }
    
    const message = {
      type: 'TASK_ASSIGN',
      payload: {
        taskId: assignment.taskId,
        subtaskId: assignment.subtaskId,
        prompt: assignment.prompt,
        model: this.config.agentModel,
        maxTokens: 512,
        temperature: 0.2
      }
    };
    
    try {
      peer.channel.send(JSON.stringify(message));
      console.log(`[P2P] Task sent to ${peer.id}`);
    } catch (e) {
      console.error(`[P2P] Failed to send to ${peer.id}:`, e);
      peer.status = 'error';
    }
  }

  /**
   * Handle completed task result from peer
   */
  handleTaskResult(peerId, taskId, subtaskId, result) {
    const assignmentId = `${taskId}_${subtaskId}`;
    const assignment = this.taskAssignments.get(assignmentId);
    const peer = this.peers.get(peerId);
    const parentTask = this.taskQueue.find(t => t.id === taskId);
    
    if (assignment) {
      assignment.status = 'completed';
      assignment.result = result;
      assignment.completedAt = Date.now();
    }
    
    if (parentTask) {
      parentTask.results[subtaskId] = result;
    }
    
    if (peer) {
      peer.activeTasks--;
      peer.completedTasks++;
      peer.status = 'idle';
    }
    
    console.log(`[P2P] Result received for ${subtaskId}`);
    
    // Check if all subtasks done
    if (parentTask && this.areAllSubtasksDone(parentTask)) {
      this.finalizeTask(parentTask);
    }
  }

  /**
   * Check if all subtasks of parent task are complete
   */
  areAllSubtasksDone(parentTask) {
    return parentTask.subtasks.every(st => 
      parentTask.results.hasOwnProperty(st.id)
    );
  }

  /**
   * Aggregate results from all subtasks
   */
  finalizeTask(parentTask) {
    parentTask.status = 'completed';
    parentTask.completedAt = Date.now();
    
    // Combine subtask results
    const aggregated = this.aggregateResults(parentTask);
    this.results.set(parentTask.id, aggregated);
    
    console.log(`[P2P] Task ${parentTask.id} completed`);
    console.log(`   Processing time: ${(parentTask.completedAt - parentTask.createdAt) / 1000}s`);
    
    return aggregated;
  }

  /**
   * Combine results from parallel subtasks
   */
  aggregateResults(parentTask) {
    const sections = [];
    
    parentTask.subtasks.forEach(st => {
      const result = parentTask.results[st.id];
      if (result) {
        sections.push({
          subtask: st.description,
          code: result.response || result,
          tokens: result.tokens || 0
        });
      }
    });
    
    return {
      taskId: parentTask.id,
      prompt: parentTask.parentPrompt,
      sections: sections,
      totalTokens: sections.reduce((sum, s) => sum + s.tokens, 0),
      processingTime: parentTask.completedAt - parentTask.createdAt,
      peersInvolved: sections.length
    };
  }

  /**
   * Get task result (poll or await)
   */
  async getTaskResult(taskId, maxWaitMs = 30000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      if (this.results.has(taskId)) {
        return this.results.get(taskId);
      }
      
      const task = this.taskQueue.find(t => t.id === taskId);
      if (task && task.status === 'error') {
        throw new Error(`Task failed: ${task.error}`);
      }
      
      await this.sleep(500); // Poll every 500ms
    }
    
    throw new Error(`Task ${taskId} did not complete within ${maxWaitMs}ms`);
  }

  /**
   * Monitor peer health
   */
  setupHeartbeat() {
    setInterval(() => {
      const now = Date.now();
      
      for (const [peerId, peer] of this.peers) {
        const timeSinceHeartbeat = now - peer.lastHeartbeat;
        
        if (timeSinceHeartbeat > 15000) { // 15 sec timeout
          console.warn(`[P2P] Peer ${peerId} heartbeat timeout`);
          this.handlePeerFailure(peerId);
        }
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Handle peer disconnect/failure
   */
  handlePeerFailure(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    
    console.log(`[P2P] Removing failed peer: ${peerId}`);
    
    // Reassign its tasks to other peers
    const failedAssignments = Array.from(this.taskAssignments.values()).filter(a => 
      a.peerId === peerId && a.status !== 'completed'
    );
    
    failedAssignments.forEach(assignment => {
      assignment.status = 'queued'; // Re-queue
      console.log(`[P2P] Reassigning ${assignment.taskId} to queue`);
    });
    
    this.peers.delete(peerId);
    this.scheduleNextTasks();
  }

  /**
   * Get coordinator status
   */
  getStatus() {
    return {
      coordinatorId: this.agentId,
      peers: Array.from(this.peers.values()).map(p => ({
        id: p.id,
        status: p.status,
        activeTasks: p.activeTasks,
        completedTasks: p.completedTasks,
        capabilities: p.capabilities
      })),
      taskQueue: {
        queued: this.taskQueue.filter(t => t.status === 'queued').length,
        inProgress: Array.from(this.taskAssignments.values()).filter(a => a.status === 'assigned').length,
        completed: this.taskQueue.filter(t => t.status === 'completed').length
      },
      results: this.results.size
    };
  }

  // Utilities
  generateId() {
    return `coord_${Math.random().toString(36).substr(2, 9)}`;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export { P2PAgenticCoordinator };
