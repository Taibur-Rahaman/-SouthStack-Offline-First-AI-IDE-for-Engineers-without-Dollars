/* Runs before ES modules so WebLLM always sees a working requestAdapterInfo. */
(function () {
  'use strict';
  var ENDPOINT = 'http://127.0.0.1:7895/ingest/561479c7-4a93-41fe-85d2-dcfdecab8321';
  function agentLog(hypothesisId, location, message, data) {
    var entry = {
      sessionId: '85d3ca',
      runId: 'early-shim',
      hypothesisId: hypothesisId,
      location: location,
      message: message,
      data: data || {},
      timestamp: Date.now()
    };
    try {
      var a = (window.__southstackDbgLog = window.__southstackDbgLog || []);
      a.push(entry);
      if (a.length > 200) a.shift();
    } catch (e0) {}
    var payload = JSON.stringify(entry);
    try {
      console.info('[debug-85d3ca]', payload);
    } catch (e1) {}
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '85d3ca' },
        body: payload
      }).catch(function () {});
    } catch (e2) {}
  }
  try {
    agentLog('H0', 'webgpu-early-compat:eval', 'script ran', { hasGpu: !!navigator.gpu });
    if (typeof GPUAdapter === 'undefined') return;
    var origProto = GPUAdapter.prototype.requestAdapterInfo;
    GPUAdapter.prototype.requestAdapterInfo = async function requestAdapterInfoCompat() {
      if (typeof origProto === 'function') {
        try {
          return await origProto.call(this);
        } catch (e) {
          agentLog('H6', 'webgpu-early-compat:nativeRai', 'native requestAdapterInfo failed', {
            err: String((e && e.message) || e)
          });
        }
      }
      var info = this && this.info;
      if (info && typeof info === 'object') {
        return {
          vendor: info.vendor || 'unknown',
          architecture: info.architecture || 'unknown',
          device: info.device || 'unknown',
          description: info.description || 'unknown'
        };
      }
      return {
        vendor: 'unknown',
        architecture: 'unknown',
        device: 'unknown',
        description: 'unknown'
      };
    };
    if (!navigator.gpu || typeof navigator.gpu.requestAdapter !== 'function') return;
    var ng = navigator.gpu;
    if (ng.__southstackGpuPatched) {
      agentLog('H0', 'webgpu-early-compat:skip', 'already patched', {});
      return;
    }
    ng.__southstackGpuPatched = true;
    var origRA = ng.requestAdapter.bind(ng);
    ng.requestAdapter = async function (options) {
      var adapter = await origRA(options);
      var before = adapter ? typeof adapter.requestAdapterInfo : 'none';
      if (adapter && typeof adapter.requestAdapterInfo !== 'function') {
        adapter.requestAdapterInfo = GPUAdapter.prototype.requestAdapterInfo;
      }
      var after = adapter ? typeof adapter.requestAdapterInfo : 'none';
      agentLog('H1', 'webgpu-early-compat:requestAdapter', 'adapter instance', {
        before: before,
        after: after,
        hasAdapter: !!adapter
      });
      return adapter;
    };
    agentLog('H5', 'webgpu-early-compat:exit', 'installed', {
      protoRai: typeof GPUAdapter.prototype.requestAdapterInfo
    });
  } catch (err) {
    agentLog('H2', 'webgpu-early-compat:catch', 'threw', { err: String((err && err.message) || err) });
  }
  window.exportSouthstackDebugLog = function () {
    try {
      var blob = new Blob([JSON.stringify(window.__southstackDbgLog || [], null, 2)], {
        type: 'application/json'
      });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'southstack-debug-85d3ca.json';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {}
  };
})();
