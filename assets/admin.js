/* Ars Nova Site Notes — admin review screen */
( function () {
	'use strict';
	if ( typeof ansNotesAdmin === 'undefined' ) { return; }

	var app = document.getElementById( 'ansn-admin-app' );
	var all = [];
	var filters = { status: 'open', type: 'all', area: 'all', q: '' };

	function api( path, method, body ) {
		return fetch( ansNotesAdmin.rest + path, {
			method: method || 'GET',
			headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': ansNotesAdmin.nonce },
			credentials: 'same-origin',
			body: body ? JSON.stringify( body ) : undefined
		} ).then( function ( r ) {
			if ( ! r.ok ) { return r.json().then( function ( e ) { throw e; } ); }
			return r.json();
		} );
	}

	function el( tag, cls, html ) {
		var e = document.createElement( tag );
		if ( cls ) { e.className = cls; }
		if ( html !== undefined ) { e.innerHTML = html; }
		return e;
	}

	/* ---------- send to Claude Desktop ----------
	 * Same brief as the in-context notes panel. Opens Claude Desktop on a new
	 * Cowork task via claude://cowork/new?q=…&folder=…, falling back to a plain
	 * new chat when no project folder has been configured in Settings.
	 */
	var CLAUDE_MAX_Q = 13000;

	function claudeCfg() { return ansNotesAdmin.claude || {}; }

	function claudeBrief( n ) {
		var cfg   = claudeCfg();
		var home  = cfg.home || ansNotesAdmin.home || '';
		var lines = [];

		lines.push( 'Branch: ' + ( cfg.branch || 'Website' ) + ' — Ars Nova site note. Run ans-router, load the' );
		lines.push( 'matching branch HANDOFF, then handle the note below.' );
		lines.push( '' );
		lines.push( 'SITE NOTE #' + n.id + ' · P' + n.priority + ' · ' +
			( n.type || 'general' ) + ' · ' + ( n.done ? 'Done' : 'Open' ) );
		lines.push( 'Site:  ' + ( cfg.siteLabel ? cfg.siteLabel + ' — ' : '' ) + home );
		lines.push( 'Page:  ' + ( n.page_title || n.page_url ) + ' — ' + decodeURIComponent( n.page_url || '' ) );
		if ( ( n.context || 'frontend' ) === 'admin' ) {
			lines.push( 'Area:  WP-Admin back-end screen (not a public page)' );
		}
		if ( n.element_selector ) {
			lines.push( 'Element: ' + n.element_selector +
				( n.element_label ? ' ("' + n.element_label + '")' : '' ) );
		}
		lines.push( 'Added by ' + ( n.author || 'a site editor' ) + ' · ' + ( n.created || '' ) );
		lines.push( '' );
		lines.push( 'NOTE' );
		lines.push( n.text );
		lines.push( '' );
		lines.push( 'Page:  ' + home.replace( /\/+$/, '' ) + ( n.page_url || '' ) );
		lines.push( 'Notes: ' + ( cfg.notesUrl || '' ) );
		lines.push( 'When the work is done, mark note #' + n.id + ' done in Site Notes.' );

		return lines.join( '\n' ).slice( 0, CLAUDE_MAX_Q );
	}

	function claudeUrl( n ) {
		var cfg = claudeCfg();
		var q   = encodeURIComponent( claudeBrief( n ) );
		if ( cfg.folder ) {
			return 'claude://cowork/new?q=' + q + '&folder=' + encodeURIComponent( cfg.folder );
		}
		return 'claude://claude.ai/new?q=' + q;
	}

	function flash( btn, label ) {
		var was = btn.textContent;
		btn.textContent = label;
		setTimeout( function () { btn.textContent = was; }, 1400 );
	}

	function sendToClaude( n, btn, ev ) {
		// Alt/Shift-click copies the brief rather than launching the app.
		if ( ev && ( ev.altKey || ev.shiftKey ) ) {
			var text = claudeBrief( n );
			if ( navigator.clipboard && navigator.clipboard.writeText ) {
				navigator.clipboard.writeText( text ).then( function () { flash( btn, 'copied' ); } );
			} else {
				window.prompt( 'Copy this note:', text );
			}
			return;
		}
		window.location.href = claudeUrl( n );
		flash( btn, 'sent →' );
	}

	/* ---------- jump to the page the note was raised on ----------
	 * Appends ?ansn_note=<id> so the front-end script can open the panel,
	 * highlight that note and scroll its linked element into view on arrival.
	 */
	function notePageUrl( n ) {
		var home = ( claudeCfg().home || ansNotesAdmin.home || '' ).replace( /\/+$/, '' );
		var path = n.page_url || '';
		if ( ! path ) { return ''; }
		var url = /^https?:\/\//i.test( path ) ? path : home + path;
		return url + ( url.indexOf( '?' ) === -1 ? '?' : '&' ) + 'ansn_note=' + n.id;
	}

	function prioClass( p ) { return p >= 8 ? 'p-high' : ( p >= 4 ? 'p-mid' : 'p-low' ); }
	function esc( s ) { return ( s || '' ).replace( /[&<>"]/g, function ( c ) {
		return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ c ]; } ); }

	function load() {
		app.textContent = 'Loading notes…';
		api( 'notes' ).then( function ( notes ) { all = notes || []; render(); } )
			.catch( function ( e ) { app.textContent = 'Error loading notes: ' + ( e.message || e.code ); } );
	}

	function render() {
		app.innerHTML = '';
		app.appendChild( toolbar() );

		var visible = all.filter( function ( n ) {
			if ( filters.status === 'open' && n.done ) { return false; }
			if ( filters.status === 'done' && ! n.done ) { return false; }
			if ( filters.type !== 'all' && ( n.type || 'general' ) !== filters.type ) { return false; }
			if ( filters.area !== 'all' && ( n.context || 'frontend' ) !== filters.area ) { return false; }
			if ( filters.q ) {
				var hay = ( n.text + ' ' + n.page_url + ' ' + ( n.page_title || '' ) ).toLowerCase();
				if ( hay.indexOf( filters.q.toLowerCase() ) === -1 ) { return false; }
			}
			return true;
		} );

		// group by page_url
		var groups = {};
		visible.forEach( function ( n ) {
			var k = n.page_url || '(no page)';
			( groups[ k ] = groups[ k ] || [] ).push( n );
		} );
		var keys = Object.keys( groups ).sort();

		if ( ! keys.length ) {
			app.appendChild( el( 'p', 'ansn-a-empty', 'No notes match the current filters.' ) );
			return;
		}

		keys.forEach( function ( k ) {
			var rows = groups[ k ].sort( function ( a, b ) {
				if ( a.done !== b.done ) { return a.done - b.done; }
				return b.priority - a.priority;
			} );
			var openCount = rows.filter( function ( r ) { return ! r.done; } ).length;

			var g = el( 'div', 'ansn-a-group' );
			var head = el( 'div', 'ansn-a-grouphead' );
			var link = el( 'a', 'ansn-a-pagelink' );
			link.href = ansNotesAdmin.home + k; link.target = '_blank';
			link.textContent = ( rows[ 0 ].page_title || k );
			head.appendChild( link );
			var gctx = ( rows[ 0 ].context || 'frontend' ) === 'admin' ? 'admin' : 'front';
			head.appendChild( el( 'span', 'ansn-a-area is-' + gctx, gctx === 'admin' ? 'Back end' : 'Front end' ) );
			head.appendChild( el( 'span', 'ansn-a-count', openCount + ' open · ' + rows.length + ' total' ) );
			var sub = el( 'span', 'ansn-a-path', k );
			g.appendChild( head );
			g.appendChild( sub );

			var table = el( 'table', 'widefat striped ansn-a-table' );
			table.innerHTML = '<thead><tr>' +
				'<th class="c-done">Done</th>' +
				'<th class="c-prio">Pri</th>' +
				'<th class="c-type">Type</th>' +
				'<th>Note</th>' +
				'<th class="c-elem">Element</th>' +
				'<th class="c-who">Added by</th>' +
				'<th class="c-when">Status</th>' +
				'<th class="c-goto">Page</th>' +
				'<th class="c-claude">Claude</th>' +
				'</tr></thead>';
			var tb = el( 'tbody' );
			rows.forEach( function ( n ) { tb.appendChild( row( n ) ); } );
			table.appendChild( tb );
			g.appendChild( table );
			app.appendChild( g );
		} );
	}

	function row( n ) {
		var tr = el( 'tr', n.done ? 'ansn-a-rowdone' : '' );

		var cDone = el( 'td', 'c-done' );
		var cb = el( 'input' );
		cb.type = 'checkbox'; cb.checked = !! n.done;
		cb.onchange = function () {
			api( 'notes/' + n.id, 'POST', { done: cb.checked ? 1 : 0 } )
				.then( function ( upd ) { replace( upd ); render(); } )
				.catch( function ( e ) { alert( e.message || e.code ); cb.checked = ! cb.checked; } );
		};
		cDone.appendChild( cb );
		tr.appendChild( cDone );

		var cPrio = el( 'td', 'c-prio' );
		cPrio.appendChild( el( 'span', 'ansn-a-badge ' + prioClass( n.priority ), 'P' + n.priority ) );
		tr.appendChild( cPrio );

		tr.appendChild( el( 'td', 'c-type', '<span class="ansn-a-tag">' + esc( n.type || 'general' ) + '</span>' ) );

		var note = el( 'td', '', '<div class="ansn-a-text">' + esc( n.text ) + '</div>' );
		tr.appendChild( note );

		var elem = el( 'td', 'c-elem' );
		elem.innerHTML = n.element_selector
			? '<span class="ansn-a-linked" title="' + esc( n.element_selector ) + '">◎ ' + esc( n.element_label || 'linked' ) + '</span>'
			: '<span class="ansn-a-none">—</span>';
		tr.appendChild( elem );

		tr.appendChild( el( 'td', 'c-who', esc( n.author || '' ) + '<br><span class="ansn-a-date">' + esc( n.created ) + '</span>' ) );

		var status = n.done
			? '<span class="ansn-a-doneflag">Done ✓</span><br><span class="ansn-a-date">' + esc( n.completed_date || '' ) +
			  ( n.completed_by ? ' · ' + esc( n.completed_by ) : '' ) + '</span>'
			: '<span class="ansn-a-openflag">Open</span>';
		tr.appendChild( el( 'td', 'c-when', status ) );

		var cGoto = el( 'td', 'c-goto' );
		var href  = notePageUrl( n );
		if ( href ) {
			var go = el( 'a', 'button button-small ansn-a-goto', '↗ Open page' );
			go.href   = href;
			go.target = '_blank';
			go.rel    = 'noopener';
			go.title  = n.element_selector
				? 'Open the page and jump straight to: ' + ( n.element_label || n.element_selector )
				: 'Open the page this note was raised on';
			cGoto.appendChild( go );
		} else {
			cGoto.appendChild( el( 'span', 'ansn-a-none', '—' ) );
		}
		tr.appendChild( cGoto );

		var cClaude = el( 'td', 'c-claude' );
		var cbtn = el( 'button', 'button button-small ansn-a-claude', '→ Claude' );
		cbtn.title = 'Open this note in Claude Desktop as a new task' +
			'\nAlt-click (or Shift-click) to copy the note instead';
		cbtn.onclick = function ( ev ) { sendToClaude( n, cbtn, ev ); };
		cClaude.appendChild( cbtn );
		tr.appendChild( cClaude );

		return tr;
	}

	function replace( upd ) {
		for ( var i = 0; i < all.length; i++ ) { if ( all[ i ].id === upd.id ) { all[ i ] = upd; return; } }
	}

	function toolbar() {
		var bar = el( 'div', 'ansn-a-toolbar' );

		var openN = all.filter( function ( n ) { return ! n.done; } ).length;
		bar.appendChild( el( 'div', 'ansn-a-stats',
			'<strong>' + openN + '</strong> open · <strong>' + all.length + '</strong> total' ) );

		var statusSel = sel( [ [ 'open', 'Open' ], [ 'done', 'Completed' ], [ 'all', 'All' ] ], filters.status );
		statusSel.onchange = function () { filters.status = statusSel.value; render(); };
		bar.appendChild( wrap( 'Status', statusSel ) );

		var typeSel = sel( [ [ 'all', 'All types' ], [ 'general', 'General' ], [ 'copy', 'Copy' ],
			[ 'design', 'Design' ], [ 'bug', 'Bug' ], [ 'idea', 'Idea' ] ], filters.type );
		typeSel.onchange = function () { filters.type = typeSel.value; render(); };
		bar.appendChild( wrap( 'Type', typeSel ) );

		var areaSel = sel( [ [ 'all', 'All areas' ], [ 'frontend', 'Front end' ], [ 'admin', 'Back end' ] ], filters.area );
		areaSel.onchange = function () { filters.area = areaSel.value; render(); };
		bar.appendChild( wrap( 'Area', areaSel ) );

		var search = el( 'input', 'ansn-a-search' );
		search.type = 'search'; search.placeholder = 'Search notes / pages…'; search.value = filters.q;
		search.oninput = function () { filters.q = search.value; render(); };
		bar.appendChild( wrap( 'Search', search ) );

		var reload = el( 'button', 'button', 'Reload' );
		reload.onclick = load;
		bar.appendChild( reload );

		return bar;
	}

	function sel( opts, val ) {
		var s = el( 'select' );
		opts.forEach( function ( o ) {
			var op = document.createElement( 'option' );
			op.value = o[ 0 ]; op.textContent = o[ 1 ];
			if ( o[ 0 ] === val ) { op.selected = true; }
			s.appendChild( op );
		} );
		return s;
	}
	function wrap( label, field ) {
		var w = el( 'label', 'ansn-a-fld' );
		w.appendChild( el( 'span', 'ansn-a-flabel', label ) );
		w.appendChild( field );
		return w;
	}

	load();
} )();
