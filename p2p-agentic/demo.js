/**
 * P2P Agentic Demo
 * 
 * Shows how to:
 * 1. Start a coordinator
 * 2. Connect multiple peers
 * 3. Distribute coding tasks
 * 4. Aggregate results
 */

import { P2PAgenticCoordinator } from './coordinator.js';
import { P2PAgenticPeerWorker } from './peer-worker.js';

/**
 * EXAMPLE 1: Single Coordinator with Multiple Peers
 * 
 * Setup:
 * - Laptop 1: Coordinator
 * - Laptop 2: Peer 1
 * - Laptop 3: Peer 2
 */
async function setupCluster() {
  console.log('═══════════════════════════════════════');
  console.log('P2P Agentic Coding System');
  console.log('═══════════════════════════════════════\n');

  // STEP 1: Create coordinator (runs on one machine)
  const coordinator = new P2PAgenticCoordinator({
    maxConcurrentTasks: 3,
    agentModel: 'Qwen2.5-Coder-1.5B-Instruct-q4f32_1'
  });

  console.log('✅ Coordinator started\n');

  // STEP 2: Simulate multiple peers connecting
  const peers = [];
  for (let i = 1; i <= 3; i++) {
    const peer = new P2PAgenticPeerWorker({
      model: 'Qwen2.5-Coder-1.5B-Instruct-q4f32_1',
      maxConcurrentTasks: 1
    });

    // Simulate peer initialization
    await peer.initialize();

    // Register peer with coordinator
    coordinator.registerPeer(peer.peerId, peer.capabilities);

    // Simulate WebRTC connection
    simulateP2PConnection(coordinator, peer);

    peers.push(peer);

    console.log(`✅ Peer ${i} connected (${peer.peerId})\n`);
  }

  return { coordinator, peers };
}

/**
 * EXAMPLE 2: Distribute a Complex Coding Task
 */
async function distributeCodingTask(coordinator) {
  console.log('📋 Distributing Complex Coding Task\n');

  const taskDef = {
    prompt: 'Build a complete Todo application with sorting and filtering',
    subtasks: [
      'Create a Todo class with properties: id, title, completed, priority, dueDate',
      'Implement sorting function: by priority, by due date, by completion',
      'Implement filtering function: show completed, show pending, show overdue',
      'Write unit tests for Todo class',
      'Write integration tests for sorting and filtering'
    ]
  };

  const taskId = await coordinator.executeDistributedTask(taskDef);

  console.log(`📌 Task assigned: ${taskId}\n`);

  // Wait for completion
  console.log('⏳ Waiting for peers to complete subtasks...\n');

  try {
    const result = await coordinator.getTaskResult(taskId, 60000); // 60 sec timeout

    console.log('✅ ALL SUBTASKS COMPLETED!\n');
    console.log('📊 Results:\n');

    result.sections.forEach((section, idx) => {
      console.log(`\n──────────────────────────────────────`);
      console.log(`📝 Subtask ${idx + 1}: ${section.subtask}`);
      console.log(`──────────────────────────────────────`);
      console.log(section.code);
      console.log(`📊 Tokens: ${section.tokens}`);
    });

    console.log(`\n\n📈 Summary:`);
    console.log(`   Total Tokens: ${result.totalTokens}`);
    console.log(`   Processing Time: ${result.processingTime / 1000}s`);
    console.log(`   Peers Involved: ${result.peersInvolved}`);

    return result;
  } catch (e) {
    console.error(`❌ Task failed:`, e.message);
  }
}

/**
 * EXAMPLE 3: Real-time Monitoring
 */
function monitorCoordinator(coordinator) {
  console.log('\n📊 Coordinator Status Monitor\n');

  const statusInterval = setInterval(() => {
    const status = coordinator.getStatus();

    console.clear();
    console.log('═══════════════════════════════════════');
    console.log('P2P Agentic Coordinator Dashboard');
    console.log('═══════════════════════════════════════\n');

    // Peers
    console.log(`🖥️  Connected Peers: ${status.peers.length}\n`);
    status.peers.forEach((peer) => {
      console.log(`   ${peer.id}`);
      console.log(`      Status: ${peer.status}`);
      console.log(`      Active Tasks: ${peer.activeTasks}`);
      console.log(`      Completed: ${peer.completedTasks}`);
      console.log(`      RAM: ${peer.capabilities.ram}GB`);
      console.log(`      GPU: ${peer.capabilities.gpu.vendor}\n`);
    });

    // Task Queue
    console.log(`📋 Task Queue:`);
    console.log(`   Queued: ${status.taskQueue.queued}`);
    console.log(`   In Progress: ${status.taskQueue.inProgress}`);
    console.log(`   Completed: ${status.taskQueue.completed}`);

    console.log(`\n💾 Results Available: ${status.results}`);
  }, 5000);

  return statusInterval;
}

/**
 * EXAMPLE 4: Load Balancing Based on Capabilities
 */
async function loadBalancingDemo(coordinator, peers) {
  console.log('\n\n⚡ Load Balancing Demo\n');

  // Create tasks of varying difficulty
  const tasks = [
    {
      prompt: 'Write quicksort algorithm',
      subtasks: [
        'Implement quicksort function',
        'Add randomized pivot selection',
        'Write test cases'
      ],
      difficulty: 'medium' // Can run on any peer
    },
    {
      prompt: 'Implement machine learning model',
      subtasks: [
        'Create neural network class',
        'Implement forward pass',
        'Implement backpropagation'
      ],
      difficulty: 'hard' // Assign to most capable peers
    },
    {
      prompt: 'Write simple hello world variations',
      subtasks: [
        'Python hello world',
        'JavaScript hello world',
        'Rust hello world'
      ],
      difficulty: 'easy' // Can run on any peer
    }
  ];

  for (const task of tasks) {
    console.log(`📌 Submitting: ${task.prompt}`);
    coordinator.executeDistributedTask(task);
  }

  console.log(`\n✅ ${tasks.length} tasks submitted to coordinator`);
}

/**
 * EXAMPLE 5: Fault Tolerance
 */
async function faultToleranceDemo(coordinator, peers) {
  console.log('\n\n🛡️  Fault Tolerance Demo\n');

  // Simulate peer failure
  console.log('⚠️  Simulating peer failure...\n');

  const failingPeerId = peers[0].peerId;
  coordinator.handlePeerFailure(failingPeerId);

  console.log(`❌ Peer ${failingPeerId} failed`);
  console.log('✅ Tasks automatically reassigned to remaining peers\n');

  const status = coordinator.getStatus();
  console.log(`Active peers: ${status.peers.length}`);
  console.log(`Reassigned tasks: ${status.taskQueue.queued}`);
}

/**
 * EXAMPLE 6: Multi-Device Setup Instructions
 */
function printSetupGuide() {
  console.log('\n\n📖 Multi-Device Setup Guide\n');
  console.log('═══════════════════════════════════════\n');

  console.log('OPTION A: Local Network (LAN)\n');
  console.log('1. Start relay server on central machine:');
  console.log('   $ node relay-server.js\n');

  console.log('2. On Coordinator Machine:');
  console.log(`   const coordinator = new P2PAgenticCoordinator({
     relayUrl: 'ws://192.168.1.100:8001'
   });
   coordinator.start();\n`);

  console.log('3. On Each Peer Machine:');
  console.log(`   const worker = new P2PAgenticPeerWorker({
     relayUrl: 'ws://192.168.1.100:8001'
   });
   await worker.initialize();\n`);

  console.log('═══════════════════════════════════════\n');

  console.log('OPTION B: Cloud (WebRTC + STUN Servers)\n');
  console.log('1. Use STUN servers (public):');
  console.log('   - stun:stun.l.google.com:19302');
  console.log('   - stun:stun1.l.google.com:19302\n');

  console.log('2. Devices connect via WebRTC ICE:\n');
  console.log(`   const rtcConfig = {
     iceServers: [
       { urls: 'stun:stun.l.google.com:19302' }
     ]
   };\n`);

  console.log('═══════════════════════════════════════\n');

  console.log('OPTION C: Same WiFi Network\n');
  console.log('1. Find coordinator IP:');
  console.log('   $ ipconfig getifaddr en0  (Mac)');
  console.log('   $ hostname -I              (Linux)\n');

  console.log('2. Connect peers:');
  console.log('   relayUrl: "ws://[coordinator-ip]:8001"\n');
}

/**
 * EXAMPLE 7: Real-world Scenario
 */
async function realWorldScenario() {
  console.log('\n\n🌍 Real-World Scenario: Building a Web Framework\n');
  console.log('═══════════════════════════════════════\n');

  const { coordinator, peers } = await setupCluster();

  console.log(`🚀 Ready with ${peers.length} peers\n`);

  const frameworkTask = {
    prompt:
      'Build a lightweight web framework in JavaScript with routing, middleware, and request parsing',
    subtasks: [
      'Create Router class with get/post/put/delete methods and wildcard support',
      'Implement Middleware system with use() method and chain execution',
      'Create Request/Response wrapper classes with headers, body, params',
      'Add JSON parser, URL encoder, and form data middleware',
      'Write comprehensive unit tests for all components',
      'Create documentation with examples'
    ]
  };

  console.log(`📋 Task: ${frameworkTask.prompt}\n`);
  console.log(`📑 Subtasks: ${frameworkTask.subtasks.length}\n`);

  const taskId = await coordinator.executeDistributedTask(frameworkTask);

  // Monitor
  const monitorInterval = monitorCoordinator(coordinator);

  // Wait for completion
  try {
    const result = await coordinator.getTaskResult(taskId, 120000); // 2 min

    clearInterval(monitorInterval);

    console.clear();
    console.log('\n✅ FRAMEWORK DEVELOPMENT COMPLETE!\n');
    console.log('═══════════════════════════════════════\n');

    result.sections.forEach((section, idx) => {
      console.log(`\n📦 Component ${idx + 1}: ${section.subtask}`);
      console.log('─'.repeat(40));
      console.log(section.code);
      console.log(`\n⏱️  ${(section.tokens / 10).toFixed(1)} sec (${section.tokens} tokens)`);
    });

    console.log('\n\n📊 Performance Metrics:');
    console.log(`   Total Time: ${(result.processingTime / 1000).toFixed(2)}s`);
    console.log(`   Parallel Speedup: ${(result.processingTime / result.peersInvolved).toFixed(2)}ms/peer`);
    console.log(`   Total Tokens: ${result.totalTokens}`);
    console.log(`   Peers Used: ${result.peersInvolved}`);
  } catch (e) {
    clearInterval(monitorInterval);
    console.error('Failed:', e.message);
  }
}

/**
 * Simulate P2P connection between coordinator and peer
 */
function simulateP2PConnection(coordinator, peer) {
  // In real implementation, this would use WebRTC DataChannels
  // For demo, we'll use postMessage

  window.addEventListener('message', (e) => {
    if (e.data.type === 'TO_COORDINATOR') {
      const payload = e.data.payload;

      // Coordinator receives message from peer
      if (payload.type === 'PEER_ANNOUNCE') {
        // Registration already done, but track channel
        const peerObj = coordinator.peers.get(peer.peerId);
        if (peerObj) {
          peerObj.lastHeartbeat = Date.now();
        }
      } else if (payload.type === 'TASK_RESULT') {
        coordinator.handleTaskResult(
          peer.peerId,
          payload.taskId,
          payload.subtaskId,
          payload.result
        );
      } else if (payload.type === 'PONG') {
        const peerObj = coordinator.peers.get(payload.peerId);
        if (peerObj) {
          peerObj.lastHeartbeat = Date.now();
        }
      }
    }
  });

  // Route coordinator messages to peer
  peer.coordinatorChannel = {
    send: (msg) => {
      const parsed = JSON.parse(msg);
      if (parsed.type === 'TASK_ASSIGN') {
        peer.handleCoordinatorMessage(parsed);
      }
    },
    readyState: 'open'
  };
}

// Export for browser console
if (typeof window !== 'undefined') {
  window.P2PAgenticDemo = {
    setupCluster,
    distributeCodingTask,
    monitorCoordinator,
    loadBalancingDemo,
    faultToleranceDemo,
    printSetupGuide,
    realWorldScenario
  };

  console.log('🚀 P2P Agentic Demo loaded!');
  console.log('Commands:');
  console.log('  P2PAgenticDemo.setupCluster()');
  console.log('  P2PAgenticDemo.distributeCodingTask(coordinator)');
  console.log('  P2PAgenticDemo.realWorldScenario()');
  console.log('  P2PAgenticDemo.printSetupGuide()\n');
}

export {
  setupCluster,
  distributeCodingTask,
  monitorCoordinator,
  loadBalancingDemo,
  faultToleranceDemo,
  printSetupGuide,
  realWorldScenario
};
