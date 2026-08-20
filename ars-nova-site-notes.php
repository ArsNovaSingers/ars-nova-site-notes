<?php
/**
 * Plugin Name: Ars Nova Site Notes
 * Description: In-context, per-page notes & change tasks for both the FRONT END and the WP-ADMIN back end. Logged-in admins/editors open a notepad on any page or admin screen (e.g. the Season Dashboard and singer dashboards), add prioritized (1-10) checklist items, optionally link a note to an element with a drag target-line, and check items off. All notes roll up into a Site Notes admin screen (filterable by front-end vs back-end) for review and tracker sync.
 * Version: 1.3.0
 * Author: Ars Nova (Jonathan Raabe)
 * Requires at least: 5.8
 * Requires PHP: 7.4
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'ANSN_VERSION', '1.3.0' );
define( 'ANSN_URL', plugin_dir_url( __FILE__ ) );
define( 'ANSN_PATH', plugin_dir_path( __FILE__ ) );

/** Capability required to use Site Notes. Filterable so a custom role can be granted. */
function ansn_cap() {
	return apply_filters( 'ansn_capability', 'edit_posts' );
}

/* -------------------------------------------------------------------------
 * "Send to Claude" configuration
 *
 * Each note gets a button that opens Claude Desktop on a new Cowork task with
 * the note pre-written into the composer, via the documented deep link
 * claude://cowork/new?q=<prompt>&folder=<absolute path>.
 *
 * The folder is machine-specific (it is a path on the marketing lead's own PC),
 * so it lives in an option rather than being hard-coded. If it is blank we fall
 * back to claude://claude.ai/new?q=<prompt>, which needs no folder at all.
 * ---------------------------------------------------------------------- */
define( 'ANSN_DEFAULT_FOLDER', 'C:\\Users\\jonra\\Claud Projects\\Ars Nova\\Ars Nova' );

function ansn_claude_config() {
	$label = get_option( 'ansn_site_label', '' );
	if ( '' === $label ) {
		$host  = wp_parse_url( home_url(), PHP_URL_HOST );
		$label = ( false !== strpos( (string) $host, 'kinsta.cloud' ) ) ? 'DEV' : 'LIVE';
	}
	return array(
		'folder'    => get_option( 'ansn_claude_folder', ANSN_DEFAULT_FOLDER ),
		'branch'    => get_option( 'ansn_claude_branch', 'Website' ),
		'siteLabel' => $label,
		'home'      => home_url(),
		'notesUrl'  => admin_url( 'admin.php?page=ans-site-notes' ),
	);
}

add_action( 'admin_init', function () {
	register_setting( 'ansn_settings', 'ansn_claude_folder', array( 'sanitize_callback' => 'sanitize_text_field' ) );
	register_setting( 'ansn_settings', 'ansn_claude_branch', array( 'sanitize_callback' => 'sanitize_text_field' ) );
	register_setting( 'ansn_settings', 'ansn_site_label',    array( 'sanitize_callback' => 'sanitize_text_field' ) );
} );

function ansn_render_settings_page() {
	$cfg = ansn_claude_config();
	echo '<div class="wrap"><h1>Site Notes Settings</h1>';
	echo '<p class="description">Controls the <strong>&rarr; Claude</strong> button on each note. The button opens Claude Desktop on a new Cowork task with the note already written out. It only works on a computer that has Claude Desktop installed.</p>';
	echo '<form method="post" action="options.php">';
	settings_fields( 'ansn_settings' );
	echo '<table class="form-table" role="presentation"><tbody>';

	echo '<tr><th scope="row"><label for="ansn_claude_folder">Project folder on your computer</label></th><td>';
	printf(
		'<input name="ansn_claude_folder" id="ansn_claude_folder" type="text" class="regular-text code" value="%s" />',
		esc_attr( get_option( 'ansn_claude_folder', ANSN_DEFAULT_FOLDER ) )
	);
	echo '<p class="description">Absolute path to the Ars Nova project folder that Claude Desktop should attach to the new task. Leave blank to open a plain new chat with no folder.</p></td></tr>';

	echo '<tr><th scope="row"><label for="ansn_claude_branch">Branch</label></th><td>';
	printf(
		'<input name="ansn_claude_branch" id="ansn_claude_branch" type="text" class="regular-text" value="%s" />',
		esc_attr( get_option( 'ansn_claude_branch', 'Website' ) )
	);
	echo '<p class="description">Named at the top of every note sent to Claude so the work is routed to the right handoff. Default: Website.</p></td></tr>';

	echo '<tr><th scope="row"><label for="ansn_site_label">Site label</label></th><td>';
	printf(
		'<input name="ansn_site_label" id="ansn_site_label" type="text" class="regular-text" value="%s" placeholder="%s" />',
		esc_attr( get_option( 'ansn_site_label', '' ) ),
		esc_attr( $cfg['siteLabel'] )
	);
	echo '<p class="description">Shown in the note so it is never ambiguous which site it came from. Left blank, this site is detected as <strong>' . esc_html( $cfg['siteLabel'] ) . '</strong>.</p></td></tr>';

	echo '</tbody></table>';
	submit_button();
	echo '</form></div>';
}

/* -------------------------------------------------------------------------
 * Custom post type + meta
 * ---------------------------------------------------------------------- */
add_action( 'init', function () {
	register_post_type( 'ans_site_note', array(
		'labels'          => array( 'name' => 'Site Notes', 'singular_name' => 'Site Note' ),
		'public'          => false,
		'show_ui'         => false,            // we provide our own admin screen
		'show_in_rest'    => true,
		'rest_base'       => 'ans_site_note',
		'supports'        => array( 'title', 'editor', 'author', 'custom-fields' ),
		'capability_type' => 'post',
		'map_meta_cap'    => true,
	) );

	$meta = array(
		'ans_page_url'         => 'string',
		'ans_page_title'       => 'string',
		'ans_priority'         => 'integer',
		'ans_type'             => 'string',
		'ans_done'             => 'integer',
		'ans_completed_date'   => 'string',
		'ans_completed_by'     => 'string',
		'ans_element_selector' => 'string',
		'ans_element_label'    => 'string',
		'ans_context'          => 'string',
		'ans_admin_screen'     => 'string',
	);
	foreach ( $meta as $key => $type ) {
		register_post_meta( 'ans_site_note', $key, array(
			'show_in_rest'  => true,
			'single'        => true,
			'type'          => $type,
			'auth_callback' => function () { return current_user_can( ansn_cap() ); },
		) );
	}
} );

/* -------------------------------------------------------------------------
 * REST API
 * ---------------------------------------------------------------------- */
add_action( 'rest_api_init', function () {
	$perm = function () { return is_user_logged_in() && current_user_can( ansn_cap() ); };

	register_rest_route( 'ans-notes/v1', '/notes', array(
		array( 'methods' => 'GET',  'callback' => 'ansn_rest_list',   'permission_callback' => $perm ),
		array( 'methods' => 'POST', 'callback' => 'ansn_rest_create', 'permission_callback' => $perm ),
	) );
	register_rest_route( 'ans-notes/v1', '/notes/(?P<id>\d+)', array(
		array( 'methods' => 'POST',   'callback' => 'ansn_rest_update', 'permission_callback' => $perm ),
		array( 'methods' => 'DELETE', 'callback' => 'ansn_rest_delete', 'permission_callback' => $perm ),
	) );
} );

function ansn_format_note( $id ) {
	$id = (int) $id;
	return array(
		'id'               => $id,
		'text'             => get_post_field( 'post_content', $id ),
		'page_url'         => get_post_meta( $id, 'ans_page_url', true ),
		'page_title'       => get_post_meta( $id, 'ans_page_title', true ),
		'priority'         => (int) get_post_meta( $id, 'ans_priority', true ),
		'type'             => get_post_meta( $id, 'ans_type', true ),
		'done'             => (int) get_post_meta( $id, 'ans_done', true ),
		'completed_date'   => get_post_meta( $id, 'ans_completed_date', true ),
		'completed_by'     => get_post_meta( $id, 'ans_completed_by', true ),
		'element_selector' => get_post_meta( $id, 'ans_element_selector', true ),
		'element_label'    => get_post_meta( $id, 'ans_element_label', true ),
		'context'          => get_post_meta( $id, 'ans_context', true ) ? get_post_meta( $id, 'ans_context', true ) : 'frontend',
		'admin_screen'     => get_post_meta( $id, 'ans_admin_screen', true ),
		'author'          => get_the_author_meta( 'display_name', (int) get_post_field( 'post_author', $id ) ),
		'created'         => get_post_time( 'Y-m-d H:i', false, $id ),
	);
}

function ansn_rest_list( $req ) {
	$args = array(
		'post_type'      => 'ans_site_note',
		'post_status'    => 'publish',
		'posts_per_page' => -1,
	);
	$page_url = $req->get_param( 'page_url' );
	if ( $page_url ) {
		$args['meta_query'] = array( array(
			'key'   => 'ans_page_url',
			'value' => sanitize_text_field( $page_url ),
		) );
	}
	$q   = new WP_Query( $args );
	$out = array();
	foreach ( $q->posts as $p ) {
		$out[] = ansn_format_note( $p->ID );
	}
	// Sort: open first, then priority desc, then newest first.
	usort( $out, function ( $a, $b ) {
		if ( $a['done'] !== $b['done'] ) { return $a['done'] - $b['done']; }
		if ( $a['priority'] !== $b['priority'] ) { return $b['priority'] - $a['priority']; }
		return strcmp( $b['created'], $a['created'] );
	} );
	return rest_ensure_response( $out );
}

function ansn_rest_create( $req ) {
	$p    = $req->get_json_params();
	$text = isset( $p['text'] ) ? wp_kses_post( $p['text'] ) : '';
	if ( '' === trim( wp_strip_all_tags( $text ) ) ) {
		return new WP_Error( 'ansn_empty', 'Note text is required.', array( 'status' => 400 ) );
	}
	$id = wp_insert_post( array(
		'post_type'    => 'ans_site_note',
		'post_status'  => 'publish',
		'post_title'   => 'Note: ' . wp_trim_words( $text, 8, '…' ),
		'post_content' => $text,
	), true );
	if ( is_wp_error( $id ) ) {
		return new WP_Error( 'ansn_create_failed', $id->get_error_message(), array( 'status' => 500 ) );
	}
	update_post_meta( $id, 'ans_page_url',         isset( $p['page_url'] ) ? sanitize_text_field( $p['page_url'] ) : '' );
	update_post_meta( $id, 'ans_page_title',       isset( $p['page_title'] ) ? sanitize_text_field( $p['page_title'] ) : '' );
	update_post_meta( $id, 'ans_priority',         isset( $p['priority'] ) ? max( 1, min( 10, (int) $p['priority'] ) ) : 5 );
	update_post_meta( $id, 'ans_type',             isset( $p['type'] ) ? sanitize_key( $p['type'] ) : 'general' );
	update_post_meta( $id, 'ans_done', 0 );
	update_post_meta( $id, 'ans_element_selector', isset( $p['element_selector'] ) ? sanitize_text_field( $p['element_selector'] ) : '' );
	update_post_meta( $id, 'ans_element_label',    isset( $p['element_label'] ) ? sanitize_text_field( $p['element_label'] ) : '' );
	$ctx = ( isset( $p['context'] ) && 'admin' === $p['context'] ) ? 'admin' : 'frontend';
	update_post_meta( $id, 'ans_context',          $ctx );
	update_post_meta( $id, 'ans_admin_screen',     isset( $p['admin_screen'] ) ? sanitize_text_field( $p['admin_screen'] ) : '' );
	return rest_ensure_response( ansn_format_note( $id ) );
}

function ansn_rest_update( $req ) {
	$id = (int) $req['id'];
	if ( 'ans_site_note' !== get_post_type( $id ) ) {
		return new WP_Error( 'ansn_nf', 'Note not found.', array( 'status' => 404 ) );
	}
	$p = $req->get_json_params();
	if ( array_key_exists( 'text', $p ) ) {
		$text = wp_kses_post( $p['text'] );
		wp_update_post( array(
			'ID'           => $id,
			'post_content' => $text,
			'post_title'   => 'Note: ' . wp_trim_words( $text, 8, '…' ),
		) );
	}
	if ( array_key_exists( 'priority', $p ) )         { update_post_meta( $id, 'ans_priority', max( 1, min( 10, (int) $p['priority'] ) ) ); }
	if ( array_key_exists( 'type', $p ) )             { update_post_meta( $id, 'ans_type', sanitize_key( $p['type'] ) ); }
	if ( array_key_exists( 'element_selector', $p ) ) { update_post_meta( $id, 'ans_element_selector', sanitize_text_field( $p['element_selector'] ) ); }
	if ( array_key_exists( 'element_label', $p ) )    { update_post_meta( $id, 'ans_element_label', sanitize_text_field( $p['element_label'] ) ); }
	if ( array_key_exists( 'done', $p ) ) {
		$done = $p['done'] ? 1 : 0;
		update_post_meta( $id, 'ans_done', $done );
		if ( $done ) {
			update_post_meta( $id, 'ans_completed_date', current_time( 'Y-m-d H:i' ) );
			update_post_meta( $id, 'ans_completed_by', wp_get_current_user()->display_name );
		} else {
			delete_post_meta( $id, 'ans_completed_date' );
			delete_post_meta( $id, 'ans_completed_by' );
		}
	}
	return rest_ensure_response( ansn_format_note( $id ) );
}

function ansn_rest_delete( $req ) {
	$id = (int) $req['id'];
	if ( 'ans_site_note' !== get_post_type( $id ) ) {
		return new WP_Error( 'ansn_nf', 'Note not found.', array( 'status' => 404 ) );
	}
	wp_delete_post( $id, true );
	return rest_ensure_response( array( 'deleted' => true, 'id' => $id ) );
}

/* -------------------------------------------------------------------------
 * Front-end assets + admin-bar toggle
 * ---------------------------------------------------------------------- */
add_action( 'wp_enqueue_scripts', function () {
	if ( ! is_user_logged_in() || ! current_user_can( ansn_cap() ) ) { return; }
	wp_enqueue_style( 'ansn-frontend', ANSN_URL . 'assets/frontend.css', array(), ANSN_VERSION );
	wp_enqueue_script( 'ansn-frontend', ANSN_URL . 'assets/frontend.js', array(), ANSN_VERSION, true );
	wp_localize_script( 'ansn-frontend', 'ansNotes', array(
		'rest'      => esc_url_raw( rest_url( 'ans-notes/v1/' ) ),
		'nonce'     => wp_create_nonce( 'wp_rest' ),
		'user'      => wp_get_current_user()->display_name,
		'admin_url' => admin_url( 'admin.php?page=ans-site-notes' ),
		'context'   => 'frontend',
		'claude'    => ansn_claude_config(),
	) );
} );

/* Notepad in wp-admin (back end) — same panel, on every admin screen except our own review page. */
add_action( 'admin_enqueue_scripts', function ( $hook ) {
	if ( ! is_user_logged_in() || ! current_user_can( ansn_cap() ) ) { return; }
	if ( 'toplevel_page_ans-site-notes' === $hook ) { return; } // not on the review screen itself
	wp_enqueue_style( 'ansn-frontend', ANSN_URL . 'assets/frontend.css', array(), ANSN_VERSION );
	wp_enqueue_script( 'ansn-frontend', ANSN_URL . 'assets/frontend.js', array(), ANSN_VERSION, true );
	wp_add_inline_style( 'ansn-frontend', '.wp-admin .ansn-panel{top:46px;}' );
	wp_localize_script( 'ansn-frontend', 'ansNotes', array(
		'rest'       => esc_url_raw( rest_url( 'ans-notes/v1/' ) ),
		'nonce'      => wp_create_nonce( 'wp_rest' ),
		'user'       => wp_get_current_user()->display_name,
		'admin_url'  => admin_url( 'admin.php?page=ans-site-notes' ),
		'context'    => 'admin',
		'page_title' => wp_strip_all_tags( get_admin_page_title() ),
		'claude'     => ansn_claude_config(),
	) );
} );

add_action( 'admin_bar_menu', function ( $bar ) {
	if ( ! current_user_can( ansn_cap() ) ) { return; }
	$bar->add_node( array(
		'id'    => 'ansn-toggle',
		'title' => '<span class="ab-icon dashicons dashicons-edit-page"></span><span class="ab-label">Notes</span><span id="ansn-ab-count" class="ansn-ab-count"></span>',
		'href'  => '#',
		'meta'  => array( 'onclick' => 'if(window.ANSN){ANSN.toggle();}return false;', 'title' => 'Toggle Site Notes for this page / screen' ),
	) );
}, 100 );

/* -------------------------------------------------------------------------
 * Admin review screen
 * ---------------------------------------------------------------------- */
add_action( 'admin_menu', function () {
	add_menu_page(
		'Site Notes', 'Site Notes', ansn_cap(), 'ans-site-notes',
		'ansn_render_admin_page', 'dashicons-edit-page', 26
	);
	add_submenu_page(
		'ans-site-notes', 'Site Notes Settings', 'Settings', 'manage_options',
		'ans-site-notes-settings', 'ansn_render_settings_page'
	);
} );

add_action( 'admin_enqueue_scripts', function ( $hook ) {
	if ( 'toplevel_page_ans-site-notes' !== $hook ) { return; }
	wp_enqueue_style( 'ansn-admin', ANSN_URL . 'assets/admin.css', array(), ANSN_VERSION );
	wp_enqueue_script( 'ansn-admin', ANSN_URL . 'assets/admin.js', array(), ANSN_VERSION, true );
	wp_localize_script( 'ansn-admin', 'ansNotesAdmin', array(
		'rest'   => esc_url_raw( rest_url( 'ans-notes/v1/' ) ),
		'nonce'  => wp_create_nonce( 'wp_rest' ),
		'home'   => home_url(),
		'claude' => ansn_claude_config(),
	) );
} );

function ansn_render_admin_page() {
	echo '<div class="wrap ansn-admin-wrap">';
	echo '<h1>Site Notes</h1>';
	echo '<p class="description">In-context notes &amp; change tasks captured from the front end <em>and</em> the wp-admin back end (Season Dashboard, singer dashboards, etc.). Use the <strong>Notes</strong> button in the admin bar on any page or admin screen to add more. Filter by <strong>Area</strong> to separate front-end from back-end tasks.</p>';
	echo '<div id="ansn-admin-app">Loading notes…</div>';
	echo '</div>';
}
