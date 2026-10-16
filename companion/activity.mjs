import path from 'node:path';
import crypto from 'node:crypto';
export const scopeId = folder => crypto.createHash('sha256').update(folder || '').digest('hex');
const kinds = new Set(['get_config','get_operation_status','list_directory','read_file','read_multiple_files','get_file_info','describe_files','write_file','edit_block','edit_blocks','edit_office_text','copy_file','restore_file','create_directory','move_file','delete_file','delete_directory','batch_operations','search_files','grep_files','start_search','get_more_search_results','stop_search','list_searches','import_download']);
export function activitySummary(folder, name, args = {}) {
  let kind = kinds.has(name) ? name : 'unsupported';
  let data = args || {};
  if (name === 'write_file' && typeof data.content === 'string' && typeof data.path === 'string' && folder && path.resolve(folder,data.path) === path.join(folder,'.claude-file-operation.json')) {
    try { const p = JSON.parse(data.content); if(p.protocol === 'claude-folder-operation/v1') { kind = ({batch:'batch_operations',status:'get_operation_status',read:'read_file',delete_file:'delete_file',delete_directory:'delete_directory'})[p.operation] || 'unsupported'; data = p; } } catch {}
  }
  const relative = value => {
    if (!folder || typeof value !== 'string' || value.includes('\0')) return null;
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return '不支持网址';
    const label = path.relative(folder,path.resolve(folder,value));
    if (path.isAbsolute(label) || label === '..' || label.startsWith('..'+path.sep)) return '未授权路径';
    return (label.split(path.sep).join('/') || '.').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,160);
  };
  const paths = name === 'import_download' ? [] : [data.path,data.file_path,data.source,data.destination,data.output_path,...(Array.isArray(data.paths)?data.paths.slice(0,3):[])].map(relative).filter(Boolean).slice(0,3);
  return { kind, paths, ...(Array.isArray(data.operations) ? { count:Math.min(64,data.operations.length) } : {}), ...(data.permanent === true ? { permanent:true } : {}) };
}
export function activityOutcome(result) {
  if(['interrupted','rejected'].includes(result?.status))return result.status;
  if(result?.conflict)return 'conflict';
  if(Number.isInteger(result?.failedIndex)) return result.completed ? 'partial' : result.paused?'paused':'failed';
  if(result?.replayed) return 'replayed';
  return 'completed';
}
