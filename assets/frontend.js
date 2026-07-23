/* Ars Nova Site Notes — front-end notepad
 * Per-page notes panel for logged-in admins/editors.
 * Vanilla JS, no dependencies. Exposes window.ANSN.
 */
( function () {
	'use strict';

	if ( typeof ansNotes === 'undefined' ) { return; }

	var TYPES = [
		{ v: 'general', l: 'General' },
		{ v: 'copy',    l: 'Copy' },
		{ v: 'design',  l: 'Design' },
		{ v: 'bug',     l: 'Bug' },
		{ v: 'idea',    l: 'Idea' }
	];

	var state = {
		open: false,
		loaded: false,
		notes: [],
		linkingId: null,   // note id currently being linked to an element
		activeId: null     // note whose target line is shown
	};

	var isAdmin = ( typeof ansNotes.context !== 'undefined' && ansNotes.context === 'admin' );
	// In wp-admin, include the query string (e.g. ?page=season-dashboard) so notes attach
	// to the specific admin screen rather than all of /wp-admin/admin.php.
	var pageUrl = isAdmin ? ( location.pathname + location.search ) : location.pathname;
	var pageTitle = ansNotes.page_title ? ansNotes.page_title : document.title;
	var NOUN = isAdmin ? 'this screen' : 'this page';

	/* ---------- REST helpers ---------- */
	function api( path, method, body ) {
		return fetch( ansNotes.rest + path, {
			method: method || 'GET',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': ansNotes.nonce
			},
			credentials: 'same-origin',
			body: body ? JSON.stringify( body ) : undefined
		} ).then( function ( r ) {
			if ( ! r.ok ) { return r.json().then( function ( e ) { throw e; } ); }
			return r.json();
		} );
	}

	/* ---------- element selector capture ---------- */
	function cssPath( el ) {
		if ( ! ( el instanceof Element ) ) { return ''; }
		if ( el.id ) { return '#' + cssEscape( el.id ); }
		var path = [];
		while ( el && el.nodeType === 1 && el !== document.body ) {
			var sel = el.nodeName.toLowerCase();
			var parent = el.parentNode;
			if ( ! parent ) { break; }
			var sibs = Array.prototype.filter.call( parent.children, function ( c ) {
				return c.nodeName === el.nodeName;
			} );
			if ( sibs.length > 1 ) {
				sel += ':nth-of-type(' + ( Array.prototype.indexOf.call( sibs, el ) + 1 ) + ')';
			}
			path.unshift( sel );
			el = parent;
		}
		return path.length ? ( 'body > ' + path.join( ' > ' ) ) : '';
	}

	function cssEscape( s ) {
		if ( window.CSS && CSS.escape ) { return CSS.escape( s ); }
		return String( s ).replace( /[^a-zA-Z0-9_-]/g, '\\$&' );
	}

	function findTarget( selector ) {
		if ( ! selector ) { return null; }
		try { return document.querySelector( selector ); } catch ( e ) { return null; }
	}

	/* ---------- DOM build ---------- */
	var panel, listEl, countEl, svg;

	function h( tag, cls, html ) {
		var e = document.createElement( tag );
		if ( cls ) { e.className = cls; }
		if ( html !== undefined ) { e.innerHTML = html; }
		return e;
	}

	function buildPanel() {
		panel = h( 'div', 'ansn-panel' );
		panel.style.display = 'none';

		var header = h( 'div', 'ansn-header' );
		header.appendChild( h( 'span', 'ansn-title', 'Notes — ' + NOUN ) );
		var close = h( 'button', 'ansn-x', '&times;' );
		close.title = 'Close';
		close.onclick = toggle;
		header.appendChild( close );
		panel.appendChild( header );

		var sub = h( 'div', 'ansn-sub' );
		sub.textContent = decodeURIComponent( pageUrl );
		panel.appendChild( sub );

		listEl = h( 'div', 'ansn-list' ); // appended below the composer (see order below)

		// composer ("create note") — sits ABOVE the per-page notes list
		var comp = h( 'div', 'ansn-composer' );
		var ta = h( 'textarea', 'ansn-input' );
		ta.placeholder = 'Add a note for this page…';
		ta.rows = 2;
		comp.appendChild( ta );

		var row = h( 'div', 'ansn-comp-row' );
		var typeSel = h( 'select', 'ansn-type' );
		TYPES.forEach( function ( t ) {
			var o = document.createElement( 'option' );
			o.value = t.v; o.textContent = t.l;
			typeSel.appendChild( o );
		} );
		row.appendChild( labeled( 'Type', typeSel ) );

		var pr = h( 'input', 'ansn-prio' );
		pr.type = 'number'; pr.min = 1; pr.max = 10; pr.value = 5;
		row.appendChild( labeled( 'Priority', pr ) );

		var add = h( 'button', 'ansn-add', 'Add note' );
		add.onclick = function () {
			var text = ta.value.trim();
			if ( ! text ) { ta.focus(); return; }
			add.disabled = true;
			api( 'notes', 'POST', {
				text: text,
				page_url: pageUrl,
				page_title: pageTitle,
				priority: parseInt( pr.value, 10 ) || 5,
				type: typeSel.value,
				context: isAdmin ? 'admin' : 'frontend'
			} ).then( function ( note ) {
				state.notes.push( note );
				ta.value = '';
				pr.value = 5;
				renderList();
				updateCount();
			} ).catch( showErr ).then( function () { add.disabled = false; } );
		};
		row.appendChild( add );
		comp.appendChild( row );
		panel.appendChild( comp );

		// per-page notes list (sorted by importance) — below the composer, above the footer
		var listLabel = h( 'div', 'ansn-listlabel', 'Notes on ' + NOUN );
		panel.appendChild( listLabel );
		panel.appendChild( listEl );

		var foot = h( 'div', 'ansn-foot' );
		var link = h( 'a', 'ansn-adminlink', 'Open full task list →' );
		link.href = ansNotes.admin_url; link.target = '_blank';
		foot.appendChild( link );
		panel.appendChild( foot );

		document.body.appendChild( panel );

		// SVG overlay for target lines
		svg = document.createElementNS( 'http://www.w3.org/2000/svg', 'svg' );
		svg.setAttribute( 'class', 'ansn-svg' );
		document.body.appendChild( svg );

		window.addEventListener( 'scroll', drawLine, true );
		window.addEventListener( 'resize', drawLine );
	}

	function labeled( label, field ) {
		var w = h( 'label', 'ansn-field' );
		w.appendChild( h( 'span', 'ansn-flabel', label ) );
		w.appendChild( field );
		return w;
	}

	/* ---------- render ---------- */
	function prioClass( p ) {
		if ( p >= 8 ) { return 'p-high'; }
		if ( p >= 4 ) { return 'p-mid'; }
		return 'p-low';
	}

	function renderList() {
		listEl.innerHTML = '';
		if ( ! state.notes.length ) {
			listEl.appendChild( h( 'div', 'ansn-empty', 'No notes yet for this page. Add one below.' ) );
			return;
		}
		// open first then done, each by priority desc
		var sorted = state.notes.slice().sort( function ( a, b ) {
			if ( a.done !== b.done ) { return a.done - b.done; }
			return b.priority - a.priority;
		} );
		sorted.forEach( function ( n ) {
			listEl.appendChild( renderItem( n ) );
		} );
	}

	function renderItem( n ) {
		var item = h( 'div', 'ansn-item' + ( n.done ? ' done' : '' ) );
		item.setAttribute( 'data-id', n.id );

		var cb = h( 'input', 'ansn-check' );
		cb.type = 'checkbox';
		cb.checked = !! n.done;
		cb.title = 'Mark complete';
		cb.onchange = function () {
			api( 'notes/' + n.id, 'POST', { done: cb.checked ? 1 : 0 } ).then( function ( upd ) {
				merge( upd ); renderList(); updateCount();
			} ).catch( showErr );
		};
		item.appendChild( cb );

		var body = h( 'div', 'ansn-body' );

		var txt = h( 'div', 'ansn-text' );
		txt.textContent = n.text;
		txt.title = 'Click to edit';
		txt.onclick = function () { editText( n, txt ); };
		body.appendChild( txt );

		var meta = h( 'div', 'ansn-meta' );

		var prio = h( 'span', 'ansn-badge ' + prioClass( n.priority ), 'P' + n.priority );
		prio.title = 'Click to change priority (1-10)';
		prio.onclick = function () { editPriority( n, prio ); };
		meta.appendChild( prio );

		meta.appendChild( h( 'span', 'ansn-tag', n.type || 'general' ) );

		var linkBtn = h( 'button', 'ansn-linkbtn' + ( n.element_selector ? ' linked' : '' ),
			n.element_selector ? '◎ linked' : '⊕ link to element' );
		linkBtn.title = n.element_selector
			? ( 'Linked to: ' + ( n.element_label || n.element_selector ) + ' — click to show, double-click to relink' )
			: 'Drag a line to the thing on the page this note is about';
		linkBtn.onclick = function () {
			if ( n.element_selector ) {
				state.activeId = ( state.activeId === n.id ) ? null : n.id;
				drawLine();
			} else {
				startLink( n.id );
			}
		};
		linkBtn.ondblclick = function () { startLink( n.id ); };
		meta.appendChild( linkBtn );

		if ( n.element_selector ) {
			var unlink = h( 'button', 'ansn-unlink', '✕' );
			unlink.title = 'Remove element link';
			unlink.onclick = function () {
				api( 'notes/' + n.id, 'POST', { element_selector: '', element_label: '' } ).then( function ( upd ) {
					merge( upd );
					if ( state.activeId === n.id ) { state.activeId = null; }
					renderList(); drawLine();
				} ).catch( showErr );
			};
			meta.appendChild( unlink );
		}

		var del = h( 'button', 'ansn-del', '🗑' );
		del.title = 'Delete note';
		del.onclick = function () {
			if ( ! confirm( 'Delete this note?' ) ) { return; }
			api( 'notes/' + n.id, 'DELETE' ).then( function () {
				state.notes = state.notes.filter( function ( x ) { return x.id !== n.id; } );
				if ( state.activeId === n.id ) { state.activeId = null; }
				renderList(); updateCount(); drawLine();
			} ).catch( showErr );
		};
		meta.appendChild( del );

		body.appendChild( meta );

		if ( n.completed_date ) {
			body.appendChild( h( 'div', 'ansn-completed',
				'Done ✓ ' + n.completed_date + ( n.completed_by ? ' · ' + n.completed_by : '' ) ) );
		}

		item.appendChild( body );

		item.onmouseenter = function () { if ( n.element_selector ) { hoverId = n.id; drawLine(); } };
		item.onmouseleave = function () { hoverId = null; drawLine(); };

		return item;
	}

	var hoverId = null;

	function merge( upd ) {
		for ( var i = 0; i < state.notes.length; i++ ) {
			if ( state.notes[ i ].id === upd.id ) { state.notes[ i ] = upd; return; }
		}
	}

	function editText( n, el ) {
		var ta = h( 'textarea', 'ansn-editbox' );
		ta.value = n.text; ta.rows = 2;
		el.replaceWith( ta );
		ta.focus();
		function save() {
			var v = ta.value.trim();
			if ( v && v !== n.text ) {
				api( 'notes/' + n.id, 'POST', { text: v } ).then( function ( upd ) {
					merge( upd ); renderList();
				} ).catch( showErr );
			} else {
				renderList();
			}
		}
		ta.onblur = save;
		ta.onkeydown = function ( e ) {
			if ( e.key === 'Enter' && ( e.metaKey || e.ctrlKey ) ) { ta.blur(); }
			if ( e.key === 'Escape' ) { renderList(); }
		};
	}

	function editPriority( n, el ) {
		var inp = h( 'input', 'ansn-prio-edit' );
		inp.type = 'number'; inp.min = 1; inp.max = 10; inp.value = n.priority;
		el.replaceWith( inp );
		inp.focus(); inp.select();
		function save() {
			var v = Math.max( 1, Math.min( 10, parseInt( inp.value, 10 ) || n.priority ) );
			api( 'notes/' + n.id, 'POST', { priority: v } ).then( function ( upd ) {
				merge( upd ); renderList();
			} ).catch( showErr );
		}
		inp.onblur = save;
		inp.onkeydown = function ( e ) {
			if ( e.key === 'Enter' ) { inp.blur(); }
			if ( e.key === 'Escape' ) { renderList(); }
		};
	}

	/* ---------- element linking (drag target line) ---------- */
	var linkOverlay, dragLineActive = false;

	function startLink( id ) {
		state.linkingId = id;
		document.body.classList.add( 'ansn-linking' );
		if ( ! linkOverlay ) {
			linkOverlay = h( 'div', 'ansn-linkhint',
				'🎯 Click the element on the page this note is about. (Esc to cancel)' );
			document.body.appendChild( linkOverlay );
		}
		linkOverlay.style.display = 'block';

		document.addEventListener( 'mousemove', linkMove, true );
		document.addEventListener( 'click', linkClick, true );
		document.addEventListener( 'keydown', linkKey, true );
	}

	function endLink() {
		state.linkingId = null;
		document.body.classList.remove( 'ansn-linking' );
		if ( linkOverlay ) { linkOverlay.style.display = 'none'; }
		if ( hovered ) { hovered.classList.remove( 'ansn-hl' ); hovered = null; }
		document.removeEventListener( 'mousemove', linkMove, true );
		document.removeEventListener( 'click', linkClick, true );
		document.removeEventListener( 'keydown', linkKey, true );
		drawLine();
	}

	var hovered = null;
	function linkMove( e ) {
		var el = elementUnder( e );
		if ( el === hovered ) { return; }
		if ( hovered ) { hovered.classList.remove( 'ansn-hl' ); }
		hovered = el;
		if ( hovered ) { hovered.classList.add( 'ansn-hl' ); }
		// live line from panel to cursor target
		dragLineActive = true;
		drawDragLine( e.clientX, e.clientY );
	}

	function linkClick( e ) {
		var el = elementUnder( e );
		e.preventDefault(); e.stopPropagation();
		if ( ! el ) { endLink(); return; }
		var sel = cssPath( el );
		var label = ( el.innerText || el.textContent || el.nodeName ).trim().slice( 0, 60 );
		var id = state.linkingId;
		api( 'notes/' + id, 'POST', { element_selector: sel, element_label: label } ).then( function ( upd ) {
			merge( upd );
			state.activeId = id;
			endLink();
			renderList();
			drawLine();
		} ).catch( function ( err ) { showErr( err ); endLink(); } );
	}

	function linkKey( e ) {
		if ( e.key === 'Escape' ) { endLink(); }
	}

	// element under cursor, ignoring our own UI
	function elementUnder( e ) {
		var els = document.elementsFromPoint( e.clientX, e.clientY );
		for ( var i = 0; i < els.length; i++ ) {
			if ( ! isOurUi( els[ i ] ) ) { return els[ i ]; }
		}
		return null;
	}
	function isOurUi( el ) {
		return el.closest && ( el.closest( '.ansn-panel' ) || el.closest( '.ansn-svg' ) ||
			el.closest( '.ansn-linkhint' ) || ( el.id === 'wpadminbar' ) || ( el.closest && el.closest( '#wpadminbar' ) ) );
	}

	/* ---------- target line drawing ---------- */
	function clearSvg() { while ( svg.firstChild ) { svg.removeChild( svg.firstChild ); } }

	function sizeSvg() {
		svg.setAttribute( 'width', window.innerWidth );
		svg.setAttribute( 'height', window.innerHeight );
		svg.setAttribute( 'viewBox', '0 0 ' + window.innerWidth + ' ' + window.innerHeight );
	}

	function drawDragLine( x, y ) {
		if ( ! state.open ) { return; }
		sizeSvg(); clearSvg();
		var from = panelAnchor();
		line( from.x, from.y, x, y, true );
		dot( x, y );
	}

	function drawLine() {
		if ( ! svg ) { return; }
		sizeSvg(); clearSvg();
		if ( ! state.open ) { return; }
		var showId = hoverId || state.activeId;
		if ( ! showId ) { return; }
		var note = state.notes.filter( function ( n ) { return n.id === showId; } )[ 0 ];
		if ( ! note || ! note.element_selector ) { return; }
		var target = findTarget( note.element_selector );
		var row = listEl.querySelector( '.ansn-item[data-id="' + showId + '"]' );
		if ( ! target || ! row ) { return; }
		var t = target.getBoundingClientRect();
		var r = row.getBoundingClientRect();
		var fromX = r.left;            // left edge of the note row
		var fromY = r.top + r.height / 2;
		var toX = t.left + t.width / 2;
		var toY = t.top + t.height / 2;
		// outline the target
		rect( t.left, t.top, t.width, t.height );
		line( fromX, fromY, toX, toY, false );
		dot( toX, toY );
	}

	function panelAnchor() {
		var r = panel.getBoundingClientRect();
		return { x: r.left, y: r.top + 40 };
	}

	function line( x1, y1, x2, y2, dashed ) {
		var l = document.createElementNS( 'http://www.w3.org/2000/svg', 'line' );
		l.setAttribute( 'x1', x1 ); l.setAttribute( 'y1', y1 );
		l.setAttribute( 'x2', x2 ); l.setAttribute( 'y2', y2 );
		l.setAttribute( 'class', dashed ? 'ansn-line dashed' : 'ansn-line' );
		svg.appendChild( l );
	}
	function dot( x, y ) {
		var c = document.createElementNS( 'http://www.w3.org/2000/svg', 'circle' );
		c.setAttribute( 'cx', x ); c.setAttribute( 'cy', y ); c.setAttribute( 'r', 6 );
		c.setAttribute( 'class', 'ansn-dot' );
		svg.appendChild( c );
	}
	function rect( x, y, w, hgt ) {
		var rr = document.createElementNS( 'http://www.w3.org/2000/svg', 'rect' );
		rr.setAttribute( 'x', x - 3 ); rr.setAttribute( 'y', y - 3 );
		rr.setAttribute( 'width', w + 6 ); rr.setAttribute( 'height', hgt + 6 );
		rr.setAttribute( 'rx', 4 );
		rr.setAttribute( 'class', 'ansn-targetbox' );
		svg.appendChild( rr );
	}

	/* ---------- misc ---------- */
	function showErr( err ) {
		var msg = ( err && ( err.message || err.code ) ) ? ( err.message || err.code ) : 'Something went wrong.';
		alert( 'Site Notes: ' + msg );
	}

	function updateCount() {
		var open = state.notes.filter( function ( n ) { return ! n.done; } ).length;
		if ( countEl ) {
			countEl.textContent = open ? open : '';
			countEl.style.display = open ? 'inline-block' : 'none';
		}
	}

	function load() {
		return api( 'notes?page_url=' + encodeURIComponent( pageUrl ) ).then( function ( notes ) {
			state.notes = notes || [];
			state.loaded = true;
			renderList();
			updateCount();
		} ).catch( showErr );
	}

	function toggle() {
		if ( ! panel ) { buildPanel(); }
		state.open = ! state.open;
		panel.style.display = state.open ? 'flex' : 'none';
		if ( state.open ) {
			renderList();   // show cached notes immediately
			load();         // then refresh from the server (re-renders on return)
		} else {
			state.activeId = null;
		}
		drawLine();
	}

	/* ---------- boot ---------- */
	function boot() {
		countEl = document.getElementById( 'ansn-ab-count' );
		// preload count badge without opening the panel
		api( 'notes?page_url=' + encodeURIComponent( pageUrl ) ).then( function ( notes ) {
			state.notes = notes || [];
			state.loaded = true;
			updateCount();
		} ).catch( function () {} );
	}

	window.ANSN = { toggle: toggle, reload: load };

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', boot );
	} else {
		boot();
	}
} )();
