import {explainError} from '../../companion/errors.mjs';
import {hostedArguments} from '../../companion/hosted-arguments.mjs';
import {fileURLToPath} from 'node:url';
import { FileExecutor, definitions } from '../../companion/files.mjs';
import path from 'node:path';
import { stateRoot, loadSettings } from '../../companion/settings.mjs';
import { mcpResult } from '../../companion/mcp-result.mjs';
export class DesktopCommanderIntegration {
  constructor() { this.ready = false; this.msUntilRestartAllowed = 0; }
  onDisconnect(callback) { this.disconnect = callback; }
  async initialize() { this.executor = new FileExecutor(await loadSettings(), { internalRoots:[stateRoot,fileURLToPath(new URL('../../',import.meta.url)),process.execPath], journalRoot: path.join(stateRoot, 'operations'), onActivity:activity=>process.send?.({event:'activity',activity}) }); this.ready = !!this.executor.config.folder; if (!this.ready) throw new Error('Folder is not configured'); }
  async ensureReady() { if (!this.ready) throw new Error('File executor is stopped'); }
  async verifyExecution() { await this.ensureReady(); }
  async listClientTools() { return { tools: definitions }; }
  async callClientTool(name, args, metadata = {}) {
    await this.ensureReady();
    try {
      const { content } = mcpResult(await this.executor.execute(name, hostedArguments(name,args), { operationId: metadata.operationId, channel:'cowork' }));
      if (!this.capabilityHintSent && ['read_file', 'list_directory', 'get_file_info'].includes(name)) { this.capabilityHintSent = true; content.push({ type: 'text', text: '[File capabilities] This device supports scoped reading, writing, editing, moving and deletion. Deletion defaults to system Trash. The hosted service may not list custom tools: call get_config and follow fileOperationProtocol through write_file for deletion. For efficient batches and locally verified writes, call get_config once. General commands are disabled.' }); }
      return { content };
    }
    catch (e) { return { isError: true, content: [{ type: 'text', text: e.code ? '['+e.code+'] '+explainError(e) : e.message }] }; }
  }
  async shutdown() { this.ready = false; await this.executor?.chain; this.executor?.clearReadReceipts(); }
}
