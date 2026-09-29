import * as fflate from 'fflate';
function decodeText(bytes) {
  if (bytes[0] === 255 && bytes[1] === 254) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes[0] === 254 && bytes[1] === 255) {
    return new TextDecoder('utf-16be').decode(bytes);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (e) {
    return new TextDecoder('gb18030').decode(bytes);
  }
}
function docxText(bytes) {
  const files = fflate.unzipSync(bytes, {
    filter: (entry) => {
      if (entry.name !== 'word/document.xml') {
        return false;
      }
      if (entry.originalSize > 20 * 1024 * 1024) {
        throw Error('文档正文超过 20 MB，请拆分后导入');
      }
      return true;
    },
  });
  const xml = files['word/document.xml'];
  if (!xml) {
    throw Error('未找到 DOCX 正文；请使用未加密的 .docx 文档');
  }
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(xml), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw Error('DOCX 正文格式有误');
  }
  const root = doc.documentElement;
  const ns = root.namespaceURI;
  if (
    ![
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'http://purl.oclc.org/ooxml/wordprocessingml/main',
    ].includes(ns)
  ) {
    throw Error('不支持的 DOCX 正文格式');
  }
  const walk = (node, inCell = false) => {
    if (node.nodeType !== 1) {
      return '';
    }
    if (node.namespaceURI === ns) {
      if (['del', 'moveFrom'].includes(node.localName)) {
        return '';
      }
      if (node.localName === 't') {
        return node.textContent;
      }
      if (node.localName === 'tab') {
        return '\t';
      }
      if (node.localName === 'tc') {
        return (
          [...node.childNodes]
            .map((n) => walk(n, true))
            .join('')
            .trim() + '\t'
        );
      }
      if (['br', 'cr'].includes(node.localName)) {
        return '\n';
      }
    }
    const text = [...node.childNodes].map((n) => walk(n, inCell)).join('');
    return (
      text +
      (node.namespaceURI === ns && node.localName === 'tr'
        ? '\n'
        : node.namespaceURI === ns && node.localName === 'p'
          ? inCell
            ? ' '
            : '\n'
          : '')
    );
  };
  return walk(root);
}
export { decodeText, docxText };
