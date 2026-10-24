/**
 * The trap (24 Oct 2026): addresses a program probing for weaknesses asks for
 * — secrets files, WordPress and PHP admin pages, backups — and nothing in
 * OpenCall uses or links to. Both servers answer them "not found"; the sync
 * server records each and raises a notice. Shared so the website and the
 * server agree on what is a trap.
 */
export const TRAP_PATH =
  /^\/(?:\.env|\.git\/|\.aws\/|\.ssh\/|\.DS_Store|wp-login\.php|wp-admin|wp-content|xmlrpc\.php|phpmyadmin|pma\/|admin\.php|administrator\/|config\.(?:json|php|yml)|backup(?:\.zip|\.sql|\.tar)?$|server-status|actuator|cgi-bin\/|api\/admin\/export|owa\/|vendor\/phpunit)/i;
