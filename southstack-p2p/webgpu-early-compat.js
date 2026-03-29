/* Runs before ES modules so WebLLM always sees a working requestAdapterInfo. */
(function () {
  'use strict';
  function pushDbg(hypothesisId, location, message, data) {
    try {
      var a = (window.__southstackDbgLog = window.__southstackDbgLog || []);
      a.push({
        sessionId: '85d3ca',
        runId: 'early-shim-p2p',
        hypothesisId: hypothesisId,
        location: location,
        message: message,
        data: data || {},
        timestamp: Date.now()
      });
      if (a.length > 200) a.shift();
    } catch (e) {}
  }
  try {
    pushDbg('H0', 'p2p/webgpu-early-compat:eval', 'script ran', { hasGpu: !!navigator.gpu });
    if (typeof GPUAdapter === 'undefined') return;
    var origProto = GPUAdapter.prototype.requestAdapterInfo;
    GPUAdapter.prototype.requestAdapterInfo = async function requestAdapterInfoCompat() {
      if (typeof origProto === 'function') {
        try {
          return await origProto.call(this);
        } catch (e) {
          /* fall through to shim */
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
    if (ng.__southstackGpuPatched) return;
    ng.__southstackGpuPatched = true;
    var origRA = ng.requestAdapter.bind(ng);
    ng.requestAdapter = async function (options) {
      var adapter = await origRA(options);
      var before = adapter ? typeof adapter.requestAdapterInfo : 'none';
      if (adapter && typeof adapter.requestAdapterInfo !== 'function') {
        adapter.requestAdapterInfo = GPUAdapter.prototype.requestAdapterInfo;
      }
      var after = adapter ? typeof adapter.requestAdapterInfo : 'none';
      pushDbg('H1', 'p2p/webgpu-early-compat:requestAdapter', 'adapter instance', {
        before: before,
        after: after,
        hasAdapter: !!adapter
      });
      return adapter;
    };
    pushDbg('H5', 'p2p/webgpu-early-compat:exit', 'installed', {
      protoRai: typeof GPUAdapter.prototype.requestAdapterInfo
    });
  } catch (err) {
    console.warn('[SouthStack P2P] webgpu-early-compat:', err);
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
