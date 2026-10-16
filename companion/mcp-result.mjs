export function mcpResult(result) {
  if (!result?.__image) return { content:[{ type:'text', text:JSON.stringify(result) }] };
  const { __image, ...metadata } = result;
  return { content:[{ type:'image', mimeType:__image.mimeType, data:__image.data },{ type:'text', text:JSON.stringify(metadata) }] };
}
