import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { OfficeZip } from './office-zip.mjs';
import path from 'node:path';
const WORD = ['http://schemas.openxmlformats.org/wordprocessingml/2006/main','http://purl.oclc.org/ooxml/wordprocessingml/main'];
const DRAW = ['http://schemas.openxmlformats.org/drawingml/2006/main','http://purl.oclc.org/ooxml/drawingml/main'];
const SHEET = ['http://schemas.openxmlformats.org/spreadsheetml/2006/main','http://purl.oclc.org/ooxml/spreadsheetml/main'];
export function parseXml(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || /encoding\s*=\s*["'](?!utf-8|UTF-8)[^"']+["']/.test(text)) throw new Error('只支持无外部实体的 UTF-8 Office XML。');
  let bad = false;
  const document = new DOMParser({ errorHandler: { warning() { bad = true; }, error() { bad = true; }, fatalError() { bad = true; } } }).parseFromString(text, 'application/xml');
  if (bad || !document.documentElement) throw new Error('文档 XML 无效，未改动文件。');
  const stack = [[document.documentElement, 0]]; let count = 0;
  while (stack.length) { const [node, depth] = stack.pop(); if (++count > 250000 || depth > 64) throw new Error('文档结构过大或过深。'); for (let child = node.firstChild; child; child = child.nextSibling) if (child.nodeType === 1) stack.push([child, depth + 1]); }
  return document;
}
const elements = (doc, local, namespaces) => [...Array.from(doc.getElementsByTagName('*'))].filter(n => n.localName === local && namespaces.includes(n.namespaceURI));
const textNodes = (doc, kind) => elements(doc, 't', kind === 'docx' ? WORD : DRAW);
function partsFor(zip, kind) {
  const available = [...zip.entries.keys()].filter(n => kind === 'docx' ? /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(n) : kind === 'pptx' ? /^ppt\/slides\/slide\d+\.xml$/.test(n) : /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a,b) => a.localeCompare(b,'en',{numeric:true}));
  const contentTypes = parseXml(zip.read('[Content_Types].xml'));
  if (contentTypes.documentElement.localName !== 'Types') throw new Error('Office内容类型清单无效。');
  if (kind === 'docx') { if (!available.includes('word/document.xml')) throw new Error('缺少Word正文。'); return available.map(part => ({part,label:part})); }
  const directory = kind === 'pptx' ? 'ppt' : 'xl', main = kind === 'pptx' ? 'presentation' : 'workbook';
  const doc = parseXml(zip.read(directory + '/' + main + '.xml')), relationships = parseXml(zip.read(directory + '/_rels/' + main + '.xml.rels'));
  if (doc.documentElement.localName !== main) throw new Error('Office主文档类型不匹配。');
  const links = new Map(Array.from(relationships.getElementsByTagName('*')).filter(n => n.localName === 'Relationship' && n.getAttribute('TargetMode') !== 'External').map(n => { const target = n.getAttribute('Target'); return [n.getAttribute('Id'),path.posix.normalize(target.startsWith('/') ? target.slice(1) : directory + '/' + target)]; }));
  const references = Array.from(doc.getElementsByTagName('*')).filter(n => n.localName === (kind === 'pptx' ? 'sldId' : 'sheet'));
  const ordered = references.map((n,index) => { const id = n.getAttribute('r:id') || n.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id') || n.getAttributeNS('http://purl.oclc.org/ooxml/officeDocument/relationships','id'); return {part:links.get(id),label:kind === 'xlsx' ? n.getAttribute('name') : 'Slide ' + (index+1)}; });
  if (!ordered.length || ordered.some(item => !available.includes(item.part))) throw new Error('文档页序或工作表关系无效。'); return ordered;
}
function valuesFor(zip, doc) {
  let shared = [];
  if (zip.entries.has('xl/sharedStrings.xml')) shared = elements(parseXml(zip.read('xl/sharedStrings.xml')), 'si', SHEET).map(n => elements(n, 't', SHEET).map(t => t.textContent).join(''));
  return elements(doc, 'c', SHEET).map(cell => {
    const value = elements(cell, 'v', SHEET)[0]?.textContent || '', formula = elements(cell, 'f', SHEET)[0]?.textContent;
    return { cell: cell.getAttribute('r'), value: cell.getAttribute('t') === 's' ? shared[Number(value)] ?? '' : cell.getAttribute('t') === 'inlineStr' ? elements(cell, 't', SHEET).map(n => n.textContent).join('') : value, ...(formula !== undefined ? { formula, valueIsCached: true } : {}) };
  });
}
export function readOffice(data, kind, args = {}) {
  const zip = new OfficeZip(data), sections = partsFor(zip, kind), parts = sections.map(s => s.part);
  if((args.page!==undefined && (kind!=='pptx' || !Number.isInteger(args.page) || args.page<1)) || (args.sheet!==undefined && kind!=='xlsx') || [args.part,args.page,args.sheet].filter(v=>v!==undefined).length>1) throw new Error('请用PPT页码、Excel工作表名或部分路径中的一种定位方式。');
  if(args.structure_only)return {kind,sections:sections.slice(0,100),totalParts:sections.length,partsTruncated:sections.length>100,structureOnly:true,scope:'Section names/order only; no body, picture or chart rendering.'};
  const part = args.part || (args.page!==undefined ? sections[args.page-1]?.part : args.sheet!==undefined ? sections.find(s=>s.label.toLowerCase()===args.sheet.toLowerCase())?.part : parts[0]);
  if (!parts.length || !parts.includes(part)) throw new Error('文档部分不存在，请按返回的 parts 选择。');
  const doc = parseXml(zip.read(part)), nodes = kind === 'xlsx' ? valuesFor(zip, doc) : textNodes(doc, kind).map((n, index) => ({ index, text: n.textContent }));
  const start = args.offset ?? 0, length = args.length ?? 50, maxChars = args.max_chars ?? 8000, charOffset = args.char_offset ?? 0;
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(length) || length < 1 || length > 200 || maxChars < 256 || maxChars > 20000 || charOffset < 0) throw new Error('文档读取范围无效。');
  const items = []; let remaining = maxChars, truncated = false, nextCharacter;
  for (const original of nodes.slice(start, start + length)) {
    const first = !items.length, field = kind === 'xlsx' ? 'value' : 'text';
    const item = { ...original, [field]:String(original[field]).slice(first ? charOffset : 0), ...(original.formula ? { formula:original.formula.slice(0,1000), formulaTruncated:original.formula.length > 1000 } : {}) };
    const size = JSON.stringify(item).length;
    if (size > remaining) { if (!items.length) { const clipped = { ...item, [field]:item[field].slice(0,Math.max(1,remaining - 150)), truncated:true }; delete clipped.formula; items.push(clipped); nextCharacter = charOffset + clipped[field].length; } truncated = true; break; }
    items.push(item); remaining -= size;
  }
  const next = start + items.length;
  return { kind, part, ...(kind==='pptx' ? {page:parts.indexOf(part)+1} : kind==='xlsx' ? {sheet:sections.find(s=>s.part===part).label} : {}), sections:sections.slice(0,100), partsTruncated: parts.length > 100, totalParts: parts.length, items, totalItems: nodes.length, hasMore: truncated || next < nodes.length, nextOffset: nextCharacter !== undefined ? start : next, ...(nextCharacter !== undefined ? { nextCharOffset:nextCharacter } : {}), truncated, scope: 'text only; layout, pictures and chart data are not rendered; spreadsheet formulas are not executed', editMode: kind === 'xlsx' ? 'read-only' : 'edit_office_text updates the same file by default; output_path saves a separate copy; edits use exact part/index/old_text; runs cannot be merged implicitly' };
}
export function patchOffice(data, kind, edits) {
  if (!['docx','pptx'].includes(kind)) throw new Error('只支持 Word/PPT 的局部文字修改；表格、PDF 和图片请使用原应用。');
  if (!Array.isArray(edits) || edits.length < 1 || edits.length > 128 || Buffer.byteLength(JSON.stringify(edits)) > 1024 * 1024) throw new Error('一次支持1至128个文字片段。');
  const zip = new OfficeZip(data), parts = partsFor(zip,kind).map(s => s.part), documents = new Map(), seen = new Set(); let changed = 0;
  for (const edit of edits) {
    if (!edit || Object.keys(edit).some(k => !['part','index','old_text','new_text'].includes(k)) || !parts.includes(edit.part) || !Number.isInteger(edit.index) || edit.index < 0 || typeof edit.old_text !== 'string' || typeof edit.new_text !== 'string' || /[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff]/u.test(edit.new_text)) throw new Error('文字修改参数无效。');
    const key = edit.part + ':' + edit.index; if (seen.has(key)) throw new Error('同一文字片段不能重复指定。'); seen.add(key);
    if (!documents.has(edit.part)) documents.set(edit.part, parseXml(zip.read(edit.part)));
    const doc = documents.get(edit.part), node = textNodes(doc,kind)[edit.index];
    if (!node || node.textContent !== edit.old_text) throw new Error('文字已变化或跨越多个格式片段，请重新读取相关部分。');
    if (edit.new_text !== edit.old_text) { node.textContent = edit.new_text; if (/^\s|\s$/.test(edit.new_text)) node.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve'); changed++; }
  }
  if (!changed) return { data, changed: 0 };
  const serializer = new XMLSerializer(), changes = new Map();
  for (const [name, doc] of documents) { const bytes = Buffer.from(serializer.serializeToString(doc)); parseXml(bytes); changes.set(name, bytes); }
  return { data: zip.rewrite(changes), changed, preservedParts: zip.entries.size - changes.size };
}
