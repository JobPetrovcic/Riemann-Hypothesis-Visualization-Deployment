// Hover card: a node's name and stats, and for declarations with a source range (Lean data with
// graphManifest.source) its source text from GitHub: the statement, with the proof collapsed.
// The card stays open while the mouse is over it, so its toggle and links can be used.
const sourceBase = graphManifest.source || null
const sourceFiles = new Map() // path of the .lean file -> Promise of its lines
const cardShowDelay = 350 // ms of hovering a node before its card opens
const cardHideDelay = 250 // ms after leaving the node / card before the card closes

const card = d3.select('body').append('div').attr('id', 'nodeCard').style('display', 'none')
let cardNode = null, cardAnchor = null, cardShowTimer = null, cardHideTimer = null, cardHovered = false

card
  .on('mouseenter', () => { cardHovered = true; clearTimeout(cardHideTimer); clearTimeout(cardShowTimer) })
  .on('mouseleave', () => { cardHovered = false; scheduleHideCard() })

// a node was hovered: open its card after a short delay
function scheduleShowCard(node, anchor) {
  clearTimeout(cardShowTimer)
  clearTimeout(cardHideTimer)
  if (cardNode === node) return // already open
  cardShowTimer = setTimeout(() => openCard(node, anchor), cardShowDelay)
}

function scheduleHideCard() {
  clearTimeout(cardShowTimer)
  clearTimeout(cardHideTimer)
  cardHideTimer = setTimeout(hideCard, cardHideDelay)
}

function hideCard() {
  card.style('display', 'none')
  cardNode = null
  cardHovered = false
}

function openCard(node, anchor) {
  cardNode = node
  cardAnchor = anchor
  card.html('')
  const header = card.append('div').attr('class', 'card-header')
  const title = header.append('div').attr('class', 'card-title')
  title.append('span').attr('class', 'kind-dot').style('background', getColourFromPalette(node.label))
  title.append('span').attr('class', 'card-name').text(node.name)
  const stats = header.append('table').attr('class', 'card-stats')
  function row(key, value) {
    const tr = stats.append('tr')
    tr.append('th').text(key)
    tr.append('td').text(value)
  }
  for (const [key, text] of Object.entries(nodePropertiesBasic)) {
    if (key != 'name') row(text, roundReadable(node[key], nodePropertiesBasicType[key]))
  }
  if (showAdvancedOptionsTickbox.property('checked')) {
    for (const [key, text] of Object.entries(nodePropertiesAdvanced)) {
      if (graphManifest.stats.includes(key)) row(text, roundReadable(node[key], nodePropertiesAdvancedType[key]))
    }
    row('depends on observed', isSomeObserved ? (dependsOn[node.id] ? 'yes' : 'no') : '')
  }
  card.style('display', 'block')
  placeCard()
  if (sourceBase && node.range) showSource(node)
}

// next to the hovered node, flipped to its left or moved up when it would leave the window;
// while the mouse is on the card (proof toggled, source arrived) it stays put and scrolls instead
function placeCard() {
  if (cardNode === null) return
  const box = card.node().getBoundingClientRect()
  if (cardHovered) {
    card.style('max-height', (window.innerHeight - box.top - 8) + 'px')
    card.style('max-width', `min(640px, ${window.innerWidth - box.left - 8}px)`)
    return
  }
  card.style('max-height', null).style('max-width', null)
  const r = cardAnchor.getBoundingClientRect()
  const w = card.node().offsetWidth, h = card.node().offsetHeight
  let left = r.right + 10
  if (left + w > window.innerWidth - 8) left = Math.max(8, r.left - 10 - w)
  const top = Math.max(8, Math.min(r.top - 10, window.innerHeight - h - 8))
  card.style('left', left + 'px').style('top', top + 'px')
}

function rawSourceUrl(blobUrl) {
  return blobUrl.replace(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\//, 'https://raw.githubusercontent.com/$1/$2/')
}

function fetchSourceLines(path) {
  let lines = sourceFiles.get(path)
  if (lines === undefined) {
    lines = fetch(rawSourceUrl(sourceBase) + path)
      .then(response => {
        if (!response.ok) throw new Error(response.status)
        return response.text()
      })
      .then(text => text.split('\n'))
    lines.catch(() => sourceFiles.delete(path)) // try again on a later hover
    sourceFiles.set(path, lines)
  }
  return lines
}

// Module/Path.lean: the names of the declaration's ancestors below the library root
async function sourcePath(node) {
  const parts = []
  for (let u = node.parent; u >= 0; u = nodes[u].parent) {
    await ensureNodes([u])
    if (nodes[u].parent < 0) break
    parts.push(nodes[u].name)
  }
  return parts.reverse().join('/') + '.lean'
}

async function showSource(node) {
  const [first, last] = node.range
  const section = card.append('div').attr('class', 'card-source')
  const loading = section.append('div').attr('class', 'card-muted').text('Loading source…')
  let path, text
  try {
    path = await sourcePath(node)
    if (cardNode !== node) return
    section.append('a')
      .attr('class', 'card-link')
      .attr('href', `${sourceBase}${path}#L${first}-L${last}`)
      .attr('target', '_blank')
      .attr('rel', 'noopener')
      .text('View on GitHub')
    const lines = await fetchSourceLines(path)
    text = lines.slice(first - 1, last).join('\n')
  } catch (error) {
    loading.remove() // quietly: the GitHub link (if any) stays
    return
  }
  if (cardNode !== node) return
  loading.remove()
  const cut = node.label == ':data' ? -1 : splitStatementProof(text)
  section.insert('pre', 'a').attr('class', 'card-code').text(cut < 0 ? text : text.slice(0, cut).trimEnd())
  if (cut >= 0) {
    const proof = text.slice(cut)
    const n = proof.split('\n').length
    const label = `Show proof (${n} line${n == 1 ? '' : 's'})`
    const proofPre = section.insert('pre', 'a').attr('class', 'card-code card-proof').style('display', 'none').text(proof)
    section.insert('button', 'pre.card-proof')
      .attr('class', 'card-toggle')
      .text(label)
      .on('click', function () {
        const open = proofPre.style('display') == 'none'
        proofPre.style('display', open ? 'block' : 'none')
        d3.select(this).text(open ? 'Hide proof' : label)
        placeCard()
      })
  }
  placeCard()
}

// Index where the proof/body of a declaration's source starts, or -1: the first ":=" at bracket
// depth 0, a top-level "where", or a line starting with "| " (pattern matching), whichever comes
// first. Comments ("--", nested "/- -/", doc comments) and string literals are skipped.
function splitStatementProof(text) {
  const opening = '([{⟨', closing = ')]}⟩'
  let depth = 0, lineStart = 0, i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c == '\n') {
      lineStart = i + 1
    } else if (c == '-' && text[i + 1] == '-') {
      while (i < n && text[i] != '\n') i++
      continue
    } else if (c == '/' && text[i + 1] == '-') {
      let nesting = 1
      i += 2
      while (i < n && nesting > 0) {
        if (text[i] == '/' && text[i + 1] == '-') { nesting++; i += 2 }
        else if (text[i] == '-' && text[i + 1] == '/') { nesting--; i += 2 }
        else i++
      }
      continue
    } else if (c == '"') {
      i++
      while (i < n && text[i] != '"') i += text[i] == '\\' ? 2 : 1
    } else if (opening.includes(c)) {
      depth++
    } else if (closing.includes(c)) {
      depth = Math.max(0, depth - 1)
    } else if (depth == 0) {
      // structures, classes and inductive types (also behind their generated declarations) are shown whole
      if (/[a-z]/.test(c) && !/[\w'.]/.test(text[i - 1] || '')) {
        const word = /^[\w']+/.exec(text.slice(i, i + 20))[0]
        if (word == 'structure' || word == 'class' || word == 'inductive') return -1
        if (word == 'where' && /\s/.test(text[i - 1] || '') && !/[.!?]/.test(text[i + 5] || '')) return i
        i += word.length
        continue
      }
      if (c == ':' && text[i + 1] == '=') return i
      if (c == '|' && /\s/.test(text[i + 1] || '') && text.slice(lineStart, i).trim() == '') return lineStart
    }
    i++
  }
  return -1
}
