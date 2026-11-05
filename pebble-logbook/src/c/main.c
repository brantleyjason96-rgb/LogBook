#include <pebble.h>
#include <string.h>
#include <stdlib.h>
#include <stddef.h>

// ---------------------------------------------------------------------------
// Logbook: your day on the watch. It opens on a hub of seven tiles (Say it, People, Today,
// Reflect, Stats, Log a..., Shelf). Up and Down move the focus, Select opens a tile, and holding
// Select listens from anywhere. One search covers every kind of thing, and you give it
// stars. Holds: Up/Down on the rating screen jump to 5 / 1 stars, Select on a search
// result rates it 3 stars. The phone does all the searching and number crunching and
// keeps the history; the watch only draws. Paper palette (see the C_ macros).
// ---------------------------------------------------------------------------

#define MAX_ENTRIES 25
#define LABEL_LEN 32
#define REF_LEN 40
#define ARG_LEN 100
#define MAX_DEPTH 4
#define MAX_REQS 4
#define MAX_PENDING 6
#define MAX_CONT 3
#define LIST_TIMEOUT_MS 20000

// Entry flags
#define F_RATE 1   // can be rated
#define F_OPEN 2   // can be opened (season, album, podcast...)
// On the Reflect pages (these never mix with F_RATE / F_OPEN):
#define F_BOOKMARK 4   // Reflect row: has a bookmark. Note row: a bookmark with no words.
#define F_NOTE 8       // Reflect row: has a note

// Request types (watch -> phone)
#define REQ_SEARCH 1
#define REQ_BROWSE 2
#define REQ_CONTINUE 3
#define REQ_RECENT 4
#define REQ_HOME 5
#define REQ_STATS 6
#define REQ_TAGS 7
#define REQ_MARKS 8
#define REQ_PIN 9
#define REQ_FAVS 10
#define REQ_REFLECT 11   // your latest ratings, each with its note / bookmark markers
#define REQ_NOTES 12     // what you wrote about one rating (REQ_ARG is its ref)
#define REQ_MARK 13      // bookmark or un-bookmark a rating ("ref|title")
#define REQ_PEOPLE 14    // the people you have logged, most recent first
#define REQ_TARGETS 15   // people and ratings you could add a note to, newest first
#define NOTE_LEN 240      // longest saved note (one persist slot holds up to 256 bytes)
#define SEG_LEN 200       // longest single dictation phrase
#define TAG_LEN 24

// Persistent storage
#define K_PEND_COUNT 1
#define K_PEND_BASE 10
#define K_NOTE_BASE 30   // notes live in their own slots so they can be long

// Kinds. The first five keep their old numbers so the phone side stays compatible.
#define KIND_COUNT 9
#define KIND_RECENT KIND_COUNT   // not a kind you can log, used for the Recent list
#define KIND_ALL KIND_COUNT     // search request meaning every kind at once
#define KIND_REFLECT (KIND_COUNT + 1)   // not a kind either: the Reflect pages (cyan)
#define KIND_PEOPLE 13                  // people (refs start with n:); icon 13 is a head and shoulders

// What a list window is showing.
#define MODE_PLAIN 0     // search results, seasons, Recent, Bookmarks...
#define MODE_REFLECT 1   // Reflect: your latest ratings
#define MODE_ITEM 2      // Reflect: one rating, with its notes and bookmarks
#define MODE_PEOPLE 3    // People: "Someone new" row, then the people you have logged
#define MODE_NOTETO 4    // Note tile: who or what is the note about
#define ITEM_ACTIONS 3   // rows above a rating's notes: add a note, bookmark, change rating
#define NOTE_H 60        // height of a note row

static const char *const KIND_NAMES[KIND_COUNT] = {
  "Movie", "TV show", "Podcast", "Music album", "Book",
  "Song", "Game", "Recipe", "Anything"
};

// What to say for each kind, shown under its name in the main menu.
static const char *const KIND_PROMPTS[KIND_COUNT] = {
  "Say a title", "Say a title", "Say a name", "Say album or artist", "Title or author",
  "Say song and artist", "Say a title", "Say a dish", "Say whatever it is"
};

// Order the kinds appear in the main menu.
static const uint8_t MENU_KINDS[KIND_COUNT] = { 0, 1, 2, 3, 5, 4, 6, 7, 8 };

// A list entry's flags byte: low bits say what you can do with it, the upper
// four bits carry a rating in half stars (used by the Recent list).
#define F_STARS_SHIFT 4

typedef struct {
  char label[LABEL_LEN];
  char ref[REF_LEN];
  uint8_t flags;
} Entry;

typedef struct {
  Window *window;
  MenuLayer *menu;
  AppTimer *timeout;
  int token;
  int count;
  bool ready;
  bool is_search;
  int kind;
  char header[28];
  char status[36];
  Entry *e;
  // Reflect pages only (mode is MODE_PLAIN, and the rest unused, for every other list)
  int mode;
  bool seen;        // has appeared once; appearing again means coming back to it
  bool refresh;     // the next reply overwrites the rows in place instead of starting over
  int half;         // MODE_ITEM: the rating being reflected on, in half stars
  int rated_seq;    // MODE_ITEM: s_rate_seq when this page opened
  char ref[REF_LEN];
  char title[LABEL_LEN];
} ListWin;

typedef struct {
  int type;
  int kind;
  int token;
  int tries;
  char arg[ARG_LEN];
} Req;

typedef struct {
  char ref[REF_LEN];
  char title[LABEL_LEN];
  int stars;
  char tag[TAG_LEN];
  char note[NOTE_LEN];   // a spoken bookmark or note (stars is 0 for a bookmark on its own)
} PendingLog;

static Window *s_hub_window;    // the first screen: seven tiles
static Layer *s_hub_layer;
static Window *s_home_window;   // Today: what you rated today
static Window *s_main_window;   // the full menu behind Home's Down button
static MenuLayer *s_main_menu;
static Window *s_rate_window;
static Layer *s_rate_layer;
static DictationSession *s_dict;

static ListWin *s_lists[MAX_DEPTH];
static int s_list_n;

static Entry s_cont[MAX_CONT];
static int s_cont_count;
static int s_cont_token;

static int s_next_token = 1;
static int s_search_kind;

// Rating screen state
static char s_rate_ref[REF_LEN];
static char s_rate_title[LABEL_LEN];
static int s_half = 6;   // rating in half stars, 1 to 10
static bool s_rate_to_main;
static char s_rate_tag[TAG_LEN];   // category you said for an Anything item

// Voice: what the next dictation is for (0 search, 1 category, 2 bookmark/note, 3 new person, 4 person note), and the
// item a bookmark is for.
static int s_dict_mode;   // 3: a name for someone new, 4: met + note, 5: a note only (then back to the hub)
static char s_note_ref[REF_LEN];
static char s_note_title[LABEL_LEN];

// A short message from the phone ("Saved @26:00"), shown for a moment in place of a header
// or hint.
static char s_flash[32];
static AppTimer *s_flash_timer;

// Home screen state. s_home holds the phone's list (summary line + today's ratings);
// s_just is the rating you just saved, shown at once before the phone confirms it.
#define MAX_HOME 8
static Layer *s_home_layer;
static Entry s_home[MAX_HOME];
static int s_home_count;
static int s_home_token;
static bool s_auto_listen;   // launched from quick launch: start listening right away

typedef struct {
  char ref[REF_LEN];
  char title[LABEL_LEN];
  int half;
  bool on;
} JustSaved;
static JustSaved s_just;
static AppTimer *s_just_timer;
static int s_rate_seq;   // counts ratings saved, so a Reflect page can tell it was re-rated

// Outgoing messages
static Req s_reqs[MAX_REQS];
static int s_req_n;
static Req s_flying;
static PendingLog s_pend[MAX_PENDING];
static int s_pend_n;
static int s_inflight;      // 0 nothing, 1 request, 2 rating
static time_t s_out_next;

static void copy_str(char *dst, size_t n, const char *src) {
  if (n == 0) return;
  strncpy(dst, src ? src : "", n - 1);
  dst[n - 1] = '\0';
}

// ---------------------------------------------------------------------------
// Outbox: one message at a time, requests first, then ratings.
// ---------------------------------------------------------------------------

static void save_pending(void) {
  persist_write_int(K_PEND_COUNT, s_pend_n);
  for (int i = 0; i < s_pend_n; i++) {
    persist_write_data(K_PEND_BASE + i, &s_pend[i], offsetof(PendingLog, note));
    if (s_pend[i].note[0]) persist_write_data(K_NOTE_BASE + i, s_pend[i].note, strlen(s_pend[i].note) + 1);
    else persist_delete(K_NOTE_BASE + i);
  }
}

static void load_pending(void) {
  s_pend_n = persist_exists(K_PEND_COUNT) ? persist_read_int(K_PEND_COUNT) : 0;
  if (s_pend_n < 0 || s_pend_n > MAX_PENDING) s_pend_n = 0;
  for (int i = 0; i < s_pend_n; i++) {
    memset(&s_pend[i], 0, sizeof(PendingLog));
    if (persist_read_data(K_PEND_BASE + i, &s_pend[i], offsetof(PendingLog, note)) != (int)offsetof(PendingLog, note)) {
      s_pend_n = i;
      break;
    }
    if (persist_exists(K_NOTE_BASE + i)) persist_read_data(K_NOTE_BASE + i, s_pend[i].note, NOTE_LEN);
    s_pend[i].ref[REF_LEN - 1] = '\0';
    s_pend[i].title[LABEL_LEN - 1] = '\0';
    s_pend[i].tag[TAG_LEN - 1] = '\0';
    s_pend[i].note[NOTE_LEN - 1] = '\0';
  }
}

static void pump_outbox(void) {
  if (s_inflight != 0 || time(NULL) < s_out_next) return;
  DictionaryIterator *out;

  // Ratings go first, so a request sent right after saving (Home refreshing) sees them.
  if (s_pend_n > 0) {
    if (app_message_outbox_begin(&out) != APP_MSG_OK) return;
    PendingLog *p = &s_pend[0];
    dict_write_cstring(out, MESSAGE_KEY_LOG_REF, p->ref);
    dict_write_cstring(out, MESSAGE_KEY_LOG_TITLE, p->title);
    dict_write_int32(out, MESSAGE_KEY_LOG_STARS, p->stars);
    if (p->tag[0]) dict_write_cstring(out, MESSAGE_KEY_LOG_TAG, p->tag);
    if (p->note[0]) dict_write_cstring(out, MESSAGE_KEY_LOG_NOTE, p->note);
    if (app_message_outbox_send() == APP_MSG_OK) s_inflight = 2;
    return;
  }

  if (s_req_n > 0) {
    if (app_message_outbox_begin(&out) != APP_MSG_OK) return;
    Req *r = &s_reqs[0];
    dict_write_int32(out, MESSAGE_KEY_REQ_TYPE, r->type);
    dict_write_int32(out, MESSAGE_KEY_REQ_TOKEN, r->token);
    dict_write_int32(out, MESSAGE_KEY_REQ_KIND, r->kind);
    if (r->arg[0]) dict_write_cstring(out, MESSAGE_KEY_REQ_ARG, r->arg);
    if (app_message_outbox_send() == APP_MSG_OK) {
      s_flying = *r;
      s_req_n--;
      memmove(&s_reqs[0], &s_reqs[1], sizeof(Req) * s_req_n);
      s_inflight = 1;
    }
  }
}

static void outbox_sent(DictionaryIterator *iter, void *ctx) {
  if (s_inflight == 2 && s_pend_n > 0) {
    s_pend_n--;
    memmove(&s_pend[0], &s_pend[1], sizeof(PendingLog) * s_pend_n);
    save_pending();
  }
  s_inflight = 0;
  pump_outbox();
}

static void outbox_failed(DictionaryIterator *iter, AppMessageResult reason, void *ctx) {
  // Phone probably not connected: keep everything queued and try again shortly.
  if (s_inflight == 1 && ++s_flying.tries < 5 && s_req_n < MAX_REQS) {
    memmove(&s_reqs[1], &s_reqs[0], sizeof(Req) * s_req_n);
    s_reqs[0] = s_flying;
    s_req_n++;
  }
  s_inflight = 0;
  s_out_next = time(NULL) + 4;
}

static void send_request(int type, int kind, const char *arg, int token) {
  if (s_req_n >= MAX_REQS) {
    memmove(&s_reqs[0], &s_reqs[1], sizeof(Req) * (MAX_REQS - 1));
    s_req_n = MAX_REQS - 1;
  }
  Req *r = &s_reqs[s_req_n++];
  memset(r, 0, sizeof(*r));
  r->type = type;
  r->kind = kind;
  r->token = token;
  copy_str(r->arg, sizeof(r->arg), arg);
  pump_outbox();
}

static void queue_log(const char *ref, const char *title, int stars, const char *tag, const char *note) {
  if (s_pend_n >= MAX_PENDING) {
    memmove(&s_pend[0], &s_pend[1], sizeof(PendingLog) * (MAX_PENDING - 1));
    s_pend_n = MAX_PENDING - 1;
  }
  PendingLog *p = &s_pend[s_pend_n++];
  memset(p, 0, sizeof(*p));
  copy_str(p->ref, sizeof(p->ref), ref);
  copy_str(p->title, sizeof(p->title), title);
  p->stars = stars;
  copy_str(p->tag, sizeof(p->tag), tag);
  copy_str(p->note, sizeof(p->note), note);
  save_pending();
  pump_outbox();
}

// ---------------------------------------------------------------------------
// Look and feel: one color and one drawn icon per kind of thing
// ---------------------------------------------------------------------------

// Paper palette. Every color is an exact Pebble 64-color value, so nothing dithers.
// Ground and text: white and black. Focus is a black bar. Kinds are the darker hues so a
// stripe or a badge holds 3:1 or better against white.
#define C_BG    GColorWhite
#define C_FG    GColorBlack
#define C_MUTE  GColorDarkGray
#define C_LINE  GColorLightGray
#define C_ACC   GColorDukeBlue
#define C_STAR  GColorChromeYellow      // always drawn with a black outline
#define C_OK    GColorJaegerGreen
#define C_WARN  GColorDarkCandyAppleRed

// Black or white text, whichever contrasts more with the color it sits on.
static GColor on_color(GColor c) {
  static const int LIN[4] = { 0, 91, 402, 1000 };   // linear light for 0, 85, 170, 255 (per mille)
  const int l = (2126 * LIN[c.r] + 7152 * LIN[c.g] + 722 * LIN[c.b]) / 10000;
  return (1050 * 50 >= (l + 50) * (l + 50)) ? GColorWhite : GColorBlack;
}

static GColor kind_color(int k) {
  switch (k) {
    case 0: return GColorDarkCandyAppleRed;
    case 1: return GColorCobaltBlue;
    case 2: return GColorIndigo;
    case 3: return GColorJaegerGreen;
    case 4: return GColorOrange;
    case 5: return GColorPurple;
    case 6: return GColorArmyGreen;
    case 7: return GColorWindsorTan;
    case 8: return GColorDarkGray;
    case KIND_REFLECT: return GColorBlack;
    case KIND_PEOPLE: return GColorBulgarianRose;
    default: return GColorDukeBlue;
  }
}

static int kind_from_ref(const char *ref) {
  switch (ref[0]) {
    case 'm': return 0;
    case 't': return 1;
    case 'p': return 2;
    case 'a': return 3;
    case 'b': return 4;
    case 's': return 5;
    case 'g': return 6;
    case 'r': return 7;
    case 'x': return 8;
    case 'n': return KIND_PEOPLE;
    default: return KIND_RECENT;
  }
}

static void fill_play(GContext *ctx, int x, int cy, int w, int h) {
  for (int i = 0; i < w; i++) {
    int half = (h * (w - i)) / (2 * w);
    graphics_draw_line(ctx, GPoint(x + i, cy - half), GPoint(x + i, cy + half));
  }
}

// Draws the icon for a kind centered in a square box.
static void draw_icon(GContext *ctx, int kind, GRect box, GColor fg) {
  const int cx = box.origin.x + box.size.w / 2;
  const int cy = box.origin.y + box.size.h / 2;
  graphics_context_set_stroke_color(ctx, fg);
  graphics_context_set_fill_color(ctx, fg);
  graphics_context_set_stroke_width(ctx, 2);
  switch (kind) {
    case 0:   // movie: play button
      fill_play(ctx, cx - 5, cy, 11, 14);
      break;
    case 1:   // TV: screen with antenna
      graphics_draw_round_rect(ctx, GRect(cx - 9, cy - 4, 18, 13), 2);
      graphics_draw_line(ctx, GPoint(cx - 1, cy - 5), GPoint(cx - 5, cy - 9));
      graphics_draw_line(ctx, GPoint(cx + 1, cy - 5), GPoint(cx + 5, cy - 9));
      break;
    case 2:   // podcast: microphone
      graphics_fill_rect(ctx, GRect(cx - 3, cy - 9, 7, 11), 3, GCornersAll);
      graphics_draw_line(ctx, GPoint(cx - 6, cy - 2), GPoint(cx - 6, cy + 1));
      graphics_draw_line(ctx, GPoint(cx - 6, cy + 1), GPoint(cx - 3, cy + 5));
      graphics_draw_line(ctx, GPoint(cx - 3, cy + 5), GPoint(cx + 3, cy + 5));
      graphics_draw_line(ctx, GPoint(cx + 3, cy + 5), GPoint(cx + 6, cy + 1));
      graphics_draw_line(ctx, GPoint(cx + 6, cy + 1), GPoint(cx + 6, cy - 2));
      graphics_draw_line(ctx, GPoint(cx, cy + 6), GPoint(cx, cy + 9));
      break;
    case 3:   // album: record
      graphics_draw_circle(ctx, GPoint(cx, cy), 9);
      graphics_fill_circle(ctx, GPoint(cx, cy), 3);
      break;
    case 4:   // book: two open pages
      graphics_fill_rect(ctx, GRect(cx - 9, cy - 7, 8, 14), 1, GCornersAll);
      graphics_fill_rect(ctx, GRect(cx + 1, cy - 7, 8, 14), 1, GCornersAll);
      break;
    case 5:   // song: note
      graphics_fill_circle(ctx, GPoint(cx - 3, cy + 6), 3);
      graphics_fill_rect(ctx, GRect(cx, cy - 9, 2, 16), 0, GCornerNone);
      graphics_fill_rect(ctx, GRect(cx, cy - 9, 7, 3), 0, GCornerNone);
      graphics_fill_rect(ctx, GRect(cx + 5, cy - 9, 2, 7), 0, GCornerNone);
      break;
    case 6:   // game: controller
      graphics_draw_round_rect(ctx, GRect(cx - 10, cy - 5, 20, 12), 4);
      graphics_draw_line(ctx, GPoint(cx - 7, cy + 1), GPoint(cx - 3, cy + 1));
      graphics_draw_line(ctx, GPoint(cx - 5, cy - 1), GPoint(cx - 5, cy + 3));
      graphics_fill_circle(ctx, GPoint(cx + 4, cy), 1);
      graphics_fill_circle(ctx, GPoint(cx + 7, cy + 2), 1);
      break;
    case 7:   // recipe: steaming bowl
      graphics_fill_rect(ctx, GRect(cx - 9, cy, 18, 8), 6, GCornersBottom);
      graphics_draw_line(ctx, GPoint(cx - 10, cy), GPoint(cx + 10, cy));
      graphics_draw_line(ctx, GPoint(cx - 4, cy - 3), GPoint(cx - 4, cy - 8));
      graphics_draw_line(ctx, GPoint(cx, cy - 3), GPoint(cx, cy - 8));
      graphics_draw_line(ctx, GPoint(cx + 4, cy - 3), GPoint(cx + 4, cy - 8));
      break;
    case 8:   // anything: sparkle
      graphics_draw_line(ctx, GPoint(cx, cy - 9), GPoint(cx, cy + 9));
      graphics_draw_line(ctx, GPoint(cx - 9, cy), GPoint(cx + 9, cy));
      graphics_draw_line(ctx, GPoint(cx - 6, cy - 6), GPoint(cx + 6, cy + 6));
      graphics_draw_line(ctx, GPoint(cx - 6, cy + 6), GPoint(cx + 6, cy - 6));
      break;
    case 13:  // person: head and shoulders
      graphics_fill_circle(ctx, GPoint(cx, cy - 4), 5);
      graphics_fill_rect(ctx, GRect(cx - 9, cy + 3, 18, 7), 3, GCornersTop);
      break;
    case 10:  // reflect: speech bubble with two lines of text
      graphics_draw_round_rect(ctx, GRect(cx - 10, cy - 9, 20, 14), 3);
      graphics_draw_line(ctx, GPoint(cx - 5, cy + 5), GPoint(cx - 5, cy + 9));
      graphics_draw_line(ctx, GPoint(cx - 5, cy + 9), GPoint(cx, cy + 5));
      graphics_draw_line(ctx, GPoint(cx - 5, cy - 4), GPoint(cx + 5, cy - 4));
      graphics_draw_line(ctx, GPoint(cx - 5, cy), GPoint(cx + 2, cy));
      break;
    case 11:  // bookmark: ribbon outline
      graphics_draw_line(ctx, GPoint(cx - 6, cy - 9), GPoint(cx + 6, cy - 9));
      graphics_draw_line(ctx, GPoint(cx + 6, cy - 9), GPoint(cx + 6, cy + 9));
      graphics_draw_line(ctx, GPoint(cx + 6, cy + 9), GPoint(cx, cy + 4));
      graphics_draw_line(ctx, GPoint(cx, cy + 4), GPoint(cx - 6, cy + 9));
      graphics_draw_line(ctx, GPoint(cx - 6, cy + 9), GPoint(cx - 6, cy - 9));
      break;
    case 12: {  // change rating: star outline
      static const GPoint S[10] = {
        {0, -10}, {2, -3}, {9, -3}, {4, 1}, {5, 8}, {0, 4}, {-5, 8}, {-4, 1}, {-9, -3}, {-2, -3}
      };
      for (int i = 0; i < 10; i++) {
        const GPoint p = S[i], q = S[(i + 1) % 10];
        graphics_draw_line(ctx, GPoint(cx + p.x, cy + p.y + 1), GPoint(cx + q.x, cy + q.y + 1));
      }
      break;
    }
    default:  // recent: clock
      graphics_draw_circle(ctx, GPoint(cx, cy), 8);
      graphics_draw_line(ctx, GPoint(cx, cy), GPoint(cx, cy - 5));
      graphics_draw_line(ctx, GPoint(cx, cy), GPoint(cx + 4, cy + 2));
      break;
  }
  graphics_context_set_stroke_width(ctx, 1);
}

// Tiny markers for the Reflect pages: a speech bubble (has a note) and a ribbon (bookmarked).
static void draw_note_mark(GContext *ctx, int cx, int cy, GColor c) {
  graphics_context_set_stroke_color(ctx, c);
  graphics_context_set_stroke_width(ctx, 1);
  graphics_draw_round_rect(ctx, GRect(cx - 6, cy - 5, 13, 9), 2);
  graphics_draw_line(ctx, GPoint(cx - 3, cy + 4), GPoint(cx - 3, cy + 7));
  graphics_draw_line(ctx, GPoint(cx - 3, cy + 7), GPoint(cx, cy + 4));
  graphics_draw_line(ctx, GPoint(cx - 3, cy - 2), GPoint(cx + 3, cy - 2));
  graphics_draw_line(ctx, GPoint(cx - 3, cy + 1), GPoint(cx + 1, cy + 1));
}

// notch is whatever color sits behind the ribbon (it cuts the V out of the bottom edge)
static void draw_ribbon_mark(GContext *ctx, int cx, int cy, GColor c, GColor notch) {
  graphics_context_set_fill_color(ctx, c);
  graphics_fill_rect(ctx, GRect(cx - 4, cy - 6, 9, 13), 0, GCornerNone);
  graphics_context_set_stroke_color(ctx, notch);
  graphics_context_set_stroke_width(ctx, 1);
  graphics_draw_line(ctx, GPoint(cx - 4, cy + 7), GPoint(cx, cy + 3));
  graphics_draw_line(ctx, GPoint(cx, cy + 3), GPoint(cx + 4, cy + 7));
}

// The Pebble Time 2 (emery) is 200x228, so rows can be roomy.
#define ROW_H 52
#define BADGE 36

static int row_margin(void) {
  return 8;
}

// One menu row: a colored badge with an icon, a title and an optional subtitle.
static void draw_icon_row_c(GContext *ctx, const Layer *cell, int icon, GColor kc,
                            const char *title, const char *sub) {
  GRect b = layer_get_bounds(cell);
  const bool hi = menu_cell_layer_is_highlighted(cell);
  const int m = row_margin();
  graphics_context_set_fill_color(ctx, hi ? C_FG : C_BG);
  graphics_fill_rect(ctx, b, 0, GCornerNone);

  const int bs = BADGE;
  GRect badge = GRect(m, (b.size.h - bs) / 2, bs, bs);
  graphics_context_set_fill_color(ctx, hi ? C_BG : kc);
  graphics_fill_rect(ctx, badge, 8, GCornersAll);
  draw_icon(ctx, icon, badge, hi ? C_FG : on_color(kc));

  const int tx = m + bs + 8;
  const int tw = b.size.w - tx - m;
  graphics_context_set_text_color(ctx, hi ? C_BG : C_FG);
  if (sub && sub[0]) {
    graphics_draw_text(ctx, title, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(tx, 2, tw, 22), GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    graphics_context_set_text_color(ctx, hi ? C_BG : C_MUTE);
    graphics_draw_text(ctx, sub, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                       GRect(tx, 24, tw, 18), GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  } else {
    graphics_draw_text(ctx, title, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(tx, (b.size.h - 22) / 2 - 2, tw, 22), GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  }
  if (!hi) {
    graphics_context_set_stroke_color(ctx, C_LINE);
    graphics_draw_line(ctx, GPoint(m, b.size.h - 1), GPoint(b.size.w - m, b.size.h - 1));
  }
}

// The same row in the color of a kind of thing.
static void draw_icon_row(GContext *ctx, const Layer *cell, int kind, const char *title, const char *sub) {
  draw_icon_row_c(ctx, cell, kind, kind_color(kind), title, sub);
}

// Section header: small gold caps with a rule under it.
static void draw_fancy_header(GContext *ctx, const Layer *cell, const char *text, GColor accent) {
  GRect b = layer_get_bounds(cell);
  graphics_context_set_fill_color(ctx, C_BG);
  graphics_fill_rect(ctx, b, 0, GCornerNone);
  graphics_context_set_text_color(ctx, C_ACC);
  graphics_draw_text(ctx, text, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                     GRect(row_margin() + 2, -1, b.size.w - 2 * row_margin(), 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  graphics_context_set_stroke_color(ctx, accent);
  graphics_draw_line(ctx, GPoint(row_margin() + 2, b.size.h - 2), GPoint(b.size.w - row_margin() - 2, b.size.h - 2));
}

// "Title - Author" and "Title (2021)" split into a title and a smaller second line.
static void split_label(const char *label, char *title, size_t tn, char *sub, size_t sn) {
  title[0] = sub[0] = '\0';
  const char *cut = NULL;
  for (const char *c = strstr(label, " - "); c; c = strstr(c + 1, " - ")) cut = c;
  if (cut) {
    size_t n = (size_t)(cut - label);
    if (n >= tn) n = tn - 1;
    memcpy(title, label, n);
    title[n] = '\0';
    copy_str(sub, sn, cut + 3);
    return;
  }
  size_t len = strlen(label);
  const char *par = strstr(label, " (");
  if (par && len > 0 && label[len - 1] == ')' && (len - (size_t)(par - label)) <= 8) {
    size_t n = (size_t)(par - label);
    if (n >= tn) n = tn - 1;
    memcpy(title, label, n);
    title[n] = '\0';
    size_t m = len - (size_t)(par - label) - 3;
    if (m >= sn) m = sn - 1;
    memcpy(sub, par + 2, m);
    sub[m] = '\0';
    return;
  }
  copy_str(title, tn, label);
}

// ---------------------------------------------------------------------------
// Star rating screen
// ---------------------------------------------------------------------------

static const GPoint STAR_BASE[10] = {
  {0, -16}, {4, -5}, {15, -5}, {6, 2}, {9, 13},
  {0, 7}, {-9, 13}, {-6, 2}, {-15, -5}, {-4, -5}
};

// A star outline at some size. scale is in tenths: 10 is 30 pixels wide.
typedef struct {
  GPoint pts[10];
  GPathInfo info;
  GPath *path;
  int hw;    // half the width
  int top;   // pixels above the center
  int bot;   // pixels below the center
} StarShape;

static StarShape s_big;    // rating screen
static StarShape s_mini;   // Recent list

static void star_shape_init(StarShape *s, int scale) {
  for (int i = 0; i < 10; i++) {
    s->pts[i] = GPoint(STAR_BASE[i].x * scale / 10, STAR_BASE[i].y * scale / 10);
  }
  s->info.num_points = 10;
  s->info.points = s->pts;
  s->path = gpath_create(&s->info);
  s->hw = 15 * scale / 10;
  s->top = 16 * scale / 10;
  s->bot = 13 * scale / 10;
}

static void star_shape_free(StarShape *s) {
  if (s->path) {
    gpath_destroy(s->path);
    s->path = NULL;
  }
}

// Five stars in a row; half is the rating in half stars (0 to 10). x0 is the center
// of the first star. bg is whatever color sits behind the stars (it hides the empty
// half of a half star).
static void draw_stars(GContext *ctx, StarShape *s, int x0, int cy, int spacing,
                       int half, GColor empty, GColor bg) {
  for (int i = 0; i < 5; i++) {
    const int cx = x0 + i * spacing;
    gpath_move_to(s->path, GPoint(cx, cy));
    if (half >= 2 * (i + 1)) {
      graphics_context_set_fill_color(ctx, C_STAR);
      gpath_draw_filled(ctx, s->path);
      graphics_context_set_stroke_color(ctx, C_FG);
    } else if (half == 2 * i + 1) {
      // half star: fill it, hide the right half, then outline the whole star
      graphics_context_set_fill_color(ctx, C_STAR);
      gpath_draw_filled(ctx, s->path);
      graphics_context_set_fill_color(ctx, bg);
      graphics_fill_rect(ctx, GRect(cx + 1, cy - s->top - 2, s->hw + 2, s->top + s->bot + 4),
                         0, GCornerNone);
      graphics_context_set_stroke_color(ctx, C_FG);
    } else {
      graphics_context_set_stroke_color(ctx, empty);
    }
    gpath_draw_outline(ctx, s->path);
  }
}

static const char *rating_word(int half) {
  if (half <= 2) return "Awful";
  if (half <= 4) return "Poor";
  if (half <= 6) return "Okay";
  if (half <= 8) return "Good";
  if (half == 9) return "Great";
  return "Loved it";
}

static int s_star_x0;
static int s_star_spacing;
static bool s_saved;
static AppTimer *s_save_timer;
static int s_wash;               // saved-moment border pulse, counts down 3..0
static AppTimer *s_wash_timer;

// Top to bottom: kind badge, title (with a smaller second line), stars, the word
// for the rating, and a one-line hint. Everything is sized from the screen.
static int s_star_cy, s_word_y;   // where touch lands: the star row and the rating word

static void rate_update(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  const int kind = kind_from_ref(s_rate_ref);
  const GColor kc = kind_color(kind);
  const int margin = 14;
  const int tw = b.size.w - 2 * margin;
  graphics_context_set_fill_color(ctx, C_BG);
  graphics_fill_rect(ctx, b, 0, GCornerNone);

  // banner in the kind's color (green once saved) with a dark badge holding its icon
  const int bs = 34;
  const GColor banner = s_saved ? C_OK : kc;
  graphics_context_set_fill_color(ctx, banner);
  graphics_fill_rect(ctx, GRect(0, 0, b.size.w, 52), 0, GCornerNone);
  GRect badge = GRect(b.size.w / 2 - bs / 2, 9, bs, bs);
  graphics_context_set_fill_color(ctx, C_BG);
  graphics_fill_rect(ctx, badge, 9, GCornersAll);
  if (s_saved) {
    graphics_context_set_stroke_color(ctx, C_OK);
    graphics_context_set_stroke_width(ctx, 3);
    graphics_draw_line(ctx, GPoint(badge.origin.x + 9, badge.origin.y + 18),
                       GPoint(badge.origin.x + 15, badge.origin.y + 24));
    graphics_draw_line(ctx, GPoint(badge.origin.x + 15, badge.origin.y + 24),
                       GPoint(badge.origin.x + 26, badge.origin.y + 11));
    graphics_context_set_stroke_width(ctx, 1);
  } else {
    draw_icon(ctx, kind, badge, kc);
  }

  // title and subtitle, same split as the lists ("Title - Author", "Title (2021)")
  char title[LABEL_LEN], sub[LABEL_LEN];
  split_label(s_rate_title, title, sizeof(title), sub, sizeof(sub));
  GFont tf = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  GRect tbox = GRect(margin, 56, tw, 44);
  GSize ts = graphics_text_layout_get_content_size(title, tf, tbox,
                                                   GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter);
  int y = 56 + (ts.h > 44 ? 44 : ts.h);
  graphics_context_set_text_color(ctx, C_FG);
  graphics_draw_text(ctx, title, tf, tbox, GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  if (sub[0]) {
    graphics_context_set_text_color(ctx, C_MUTE);
    graphics_draw_text(ctx, sub, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                       GRect(margin, y, tw, 18), GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
    y += 18;
  }

  // stars sit in the space between the title and the rating word
  const int caption_y = b.size.h - 26;
  const int word_y = caption_y - 30;
  const int mid = (y + 6 + word_y) / 2;
  const int cy = mid + (s_big.top - s_big.bot) / 2;
  s_star_cy = cy;
  s_word_y = word_y;
  draw_stars(ctx, &s_big, s_star_x0, cy, s_star_spacing, s_half, C_LINE, C_BG);

  char buf[24];
  if (s_saved) {
    snprintf(buf, sizeof(buf), "Saved");
  } else {
    snprintf(buf, sizeof(buf), "%d%s  %s", s_half / 2, (s_half & 1) ? ".5" : "", rating_word(s_half));
  }
  graphics_context_set_text_color(ctx, s_saved ? C_OK : C_FG);
  graphics_draw_text(ctx, buf, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                     GRect(0, word_y, b.size.w, 30),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  if (!s_saved) {
    graphics_context_set_text_color(ctx, s_flash[0] ? C_OK : C_MUTE);
    graphics_draw_text(ctx, s_flash[0] ? s_flash : 
#ifdef PBL_TOUCH
                       touch_service_is_enabled() ? "Touch stars, tap word to save" :
#endif
                       "Select save, hold note", fonts_get_system_font(FONT_KEY_GOTHIC_14),
                       GRect(margin, caption_y, tw, 18),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  }
  if (s_wash > 0) {   // a frame in the kind's color that shrinks away after saving
    graphics_context_set_stroke_color(ctx, kc);
    graphics_context_set_stroke_width(ctx, 1);
    for (int i = 0; i < s_wash * 3; i++) {
      graphics_draw_rect(ctx, GRect(i, i, b.size.w - 2 * i, b.size.h - 2 * i));
    }
  }
}

static void rate_up(ClickRecognizerRef rec, void *ctx) {
  if (s_saved) return;
  if (s_half < 10) s_half++;
  layer_mark_dirty(s_rate_layer);
}

static void rate_down(ClickRecognizerRef rec, void *ctx) {
  if (s_saved) return;
  if (s_half > 1) s_half--;
  layer_mark_dirty(s_rate_layer);
}

// Runs a moment after saving, once the check mark has been seen.
static void rate_finish(void *data) {
  s_save_timer = NULL;
  if (s_rate_to_main) {
    for (int guard = 0; guard < 8 && window_stack_get_top_window() != s_hub_window; guard++) {
      window_stack_pop(false);
    }
  } else {
    window_stack_pop(true);
  }
}

static void just_clear(void *data) {
  s_just_timer = NULL;
  s_just.on = false;
  if (s_home_layer) layer_mark_dirty(s_home_layer);
}

static void wash_step(void *data) {
  s_wash_timer = NULL;
  if (s_wash > 0) s_wash--;
  if (s_rate_layer) layer_mark_dirty(s_rate_layer);
  if (s_wash > 0) s_wash_timer = app_timer_register(90, wash_step, NULL);
}

static void rate_save(ClickRecognizerRef rec, void *ctx) {
  if (s_saved) return;
  s_wash = 3;
  if (s_wash_timer) app_timer_cancel(s_wash_timer);
  s_wash_timer = app_timer_register(90, wash_step, NULL);
  queue_log(s_rate_ref, s_rate_title, s_half, s_rate_tag, "");
  s_rate_seq++;
  // Home shows it straight away, highlighted for a few seconds
  char sub[LABEL_LEN];
  split_label(s_rate_title, s_just.title, sizeof(s_just.title), sub, sizeof(sub));
  copy_str(s_just.ref, sizeof(s_just.ref), s_rate_ref);
  s_just.half = s_half;
  s_just.on = true;
  if (s_just_timer) app_timer_cancel(s_just_timer);
  s_just_timer = app_timer_register(4000, just_clear, NULL);
  vibes_short_pulse();
  s_saved = true;
  layer_mark_dirty(s_rate_layer);
  s_save_timer = app_timer_register(600, rate_finish, NULL);
}

// Hold Select to say a bookmark or note for this item ("26 minutes in, great interview").
static void rate_note(ClickRecognizerRef rec, void *ctx) {
  if (s_saved) return;
  copy_str(s_note_ref, sizeof(s_note_ref), s_rate_ref);
  copy_str(s_note_title, sizeof(s_note_title), s_rate_title);
  s_dict_mode = 2;
  dictation_session_start(s_dict);
}

static void rate_top(ClickRecognizerRef rec, void *ctx) {
  if (s_saved) return;
  s_half = 10;
  layer_mark_dirty(s_rate_layer);
}

static void rate_bottom(ClickRecognizerRef rec, void *ctx) {
  if (s_saved) return;
  s_half = 1;
  layer_mark_dirty(s_rate_layer);
}

#ifdef PBL_TOUCH
static void rate_save(ClickRecognizerRef rec, void *ctx);

// Touch: touch or drag across the stars to set the rating, tap the rating word to save.
static void rate_touch(const TouchEvent *ev, void *ctx) {
  if (s_saved || ev->non_navigational) return;
  if (abs(ev->y - s_star_cy) <= 32) {
    int h = (2 * (ev->x - s_star_x0) + s_star_spacing) / s_star_spacing + 1;   // star centers land on 2, 4, 6, 8, 10
    if (ev->x < s_star_x0 - s_star_spacing / 2) h = 1;
    if (h < 1) h = 1;
    if (h > 10) h = 10;
    if (h != s_half) { s_half = h; layer_mark_dirty(s_rate_layer); }
  } else if (ev->type == TouchEvent_Liftoff && ev->y >= s_word_y && ev->y < s_word_y + 34) {
    rate_save(NULL, NULL);
  }
}

static void rate_appear(Window *window) { if (touch_service_is_enabled()) touch_service_subscribe(rate_touch, NULL); }
static void rate_disappear(Window *window) { touch_service_unsubscribe(); }
#endif

static void rate_click_config(void *ctx) {
  window_long_click_subscribe(BUTTON_ID_SELECT, 500, rate_note, NULL);
  window_long_click_subscribe(BUTTON_ID_UP, 500, rate_top, NULL);
  window_long_click_subscribe(BUTTON_ID_DOWN, 500, rate_bottom, NULL);
  window_single_click_subscribe(BUTTON_ID_UP, rate_up);
  window_single_click_subscribe(BUTTON_ID_DOWN, rate_down);
  window_single_click_subscribe(BUTTON_ID_SELECT, rate_save);
}

static void rate_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  s_rate_layer = layer_create(b);
  layer_set_update_proc(s_rate_layer, rate_update);
  layer_add_child(root, s_rate_layer);

  // Five stars have to fit across the screen with a small gap between them.
  const int side = 12;
  const int avail = b.size.w - 2 * side;
  int hw = (avail - 16) / 10;           // star half-width that leaves four 4px gaps
  int scale = (hw * 10 + 7) / 15;
  if (scale > 14) scale = 14;
  if (scale < 6) scale = 6;
  star_shape_init(&s_big, scale);
  s_star_spacing = (avail - 2 * s_big.hw) / 4;
  s_star_x0 = b.size.w / 2 - 2 * s_star_spacing;
}

static void rate_window_unload(Window *window) {
  if (s_save_timer) {
    app_timer_cancel(s_save_timer);
    s_save_timer = NULL;
  }
  if (s_wash_timer) {
    app_timer_cancel(s_wash_timer);
    s_wash_timer = NULL;
  }
  s_wash = 0;
  star_shape_free(&s_big);
  layer_destroy(s_rate_layer);
  s_rate_layer = NULL;
}

static void rate_push_at(const char *ref, const char *label, bool to_main, int half) {
  copy_str(s_rate_ref, sizeof(s_rate_ref), ref);
  copy_str(s_rate_title, sizeof(s_rate_title), label);
  s_half = (half >= 1 && half <= 10) ? half : 6;
  s_rate_tag[0] = '\0';
  s_saved = false;
  s_rate_to_main = to_main;
  window_stack_push(s_rate_window, true);
}

static void rate_push(const char *ref, const char *label, bool to_main) {
  rate_push_at(ref, label, to_main, 6);
}

// ---------------------------------------------------------------------------
// List windows (search results, seasons, episodes, recent)
// ---------------------------------------------------------------------------

static ListWin *find_list(int token) {
  for (int i = 0; i < s_list_n; i++) {
    if (s_lists[i]->token == token) return s_lists[i];
  }
  return NULL;
}

static void list_reload(ListWin *w) {
  if (w->menu) menu_layer_reload_data(w->menu);
}

static uint16_t list_rows(MenuLayer *ml, uint16_t section, void *data) {
  ListWin *w = data;
  const int shown = (w->ready && w->count > 0) ? w->count : 1;
  if (w->mode == MODE_PEOPLE) return 1 + shown;   // "Someone new" is always the first row
  // a rating's Reflect page always offers its actions, even before the phone has answered
  return w->mode == MODE_ITEM ? ITEM_ACTIONS + shown : shown;
}

static int16_t list_header_height(MenuLayer *ml, uint16_t section, void *data) {
  ListWin *w = data;
  return w->mode == MODE_ITEM ? 40 : 20;
}

static int16_t list_cell_height(MenuLayer *ml, MenuIndex *idx, void *data) {
  ListWin *w = data;
  if (w->mode == MODE_ITEM && idx->row >= ITEM_ACTIONS && w->ready && w->count > 0) return NOTE_H;
  return ROW_H;
}

// Top of a rating's Reflect page: its title, and its stars (or a message from the phone).
static void item_draw_header(GContext *ctx, const Layer *cell, ListWin *w) {
  GRect b = layer_get_bounds(cell);
  const GColor acc = kind_color(KIND_REFLECT);
  const int m = row_margin();
  graphics_context_set_fill_color(ctx, C_BG);
  graphics_fill_rect(ctx, b, 0, GCornerNone);
  graphics_context_set_text_color(ctx, C_FG);
  graphics_draw_text(ctx, w->header, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(m + 2, -3, b.size.w - 2 * m - 2, 22),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  if (s_flash[0]) {
    graphics_context_set_text_color(ctx, C_OK);
    graphics_draw_text(ctx, s_flash, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                       GRect(m + 2, 18, b.size.w - 2 * m - 2, 18),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  } else {
    draw_stars(ctx, &s_mini, m + 2 + s_mini.hw, 29, 2 * s_mini.hw + 4, w->half, C_LINE, C_BG);
  }
  graphics_context_set_stroke_color(ctx, acc);
  graphics_draw_line(ctx, GPoint(m + 2, b.size.h - 2), GPoint(b.size.w - m - 2, b.size.h - 2));
}

static void list_draw_header(GContext *ctx, const Layer *cell, uint16_t section, void *data) {
  ListWin *w = data;
  if (w->mode == MODE_ITEM) {
    item_draw_header(ctx, cell, w);
    return;
  }
  draw_fancy_header(ctx, cell, s_flash[0] ? s_flash : w->header, s_flash[0] ? C_OK : kind_color(w->kind));
}

static void flash_clear(void *data) {
  s_flash_timer = NULL;
  s_flash[0] = '\0';
  for (int i = 0; i < s_list_n; i++) list_reload(s_lists[i]);
  if (s_rate_layer) layer_mark_dirty(s_rate_layer);
  if (s_hub_layer) layer_mark_dirty(s_hub_layer);
}

static void flash_show(const char *text) {
  copy_str(s_flash, sizeof(s_flash), text);
  if (s_flash_timer) app_timer_cancel(s_flash_timer);
  s_flash_timer = app_timer_register(2500, flash_clear, NULL);
  vibes_short_pulse();
  for (int i = 0; i < s_list_n; i++) list_reload(s_lists[i]);
  if (s_rate_layer) layer_mark_dirty(s_rate_layer);
  if (s_hub_layer) layer_mark_dirty(s_hub_layer);
}

// Plain message row (loading, nothing found), wrapped over two lines.
static void draw_message_row(GContext *ctx, const Layer *cell, const char *msg) {
  GRect b = layer_get_bounds(cell);
  graphics_context_set_fill_color(ctx, C_BG);
  graphics_fill_rect(ctx, b, 0, GCornerNone);
  graphics_context_set_text_color(ctx, C_MUTE);
  graphics_draw_text(ctx, msg, fonts_get_system_font(FONT_KEY_GOTHIC_18),
                     GRect(row_margin() + 2, 3, b.size.w - 2 * row_margin() - 4, b.size.h - 4),
                     GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);
}

// One row of a rating's Reflect page: three things to do, then what you wrote about it.
static void item_draw_row(GContext *ctx, const Layer *cell, int row, ListWin *w) {
  const GColor acc = kind_color(KIND_REFLECT);
  if (row == 0) {
    draw_icon_row_c(ctx, cell, 2, acc, "Add a note", "On your last mark, or new");
    return;
  }
  if (row == 1) {
    bool marked = false;
    for (int i = 0; i < w->count; i++) {
      if (w->e[i].flags & F_BOOKMARK) marked = true;
    }
    draw_icon_row_c(ctx, cell, 11, acc, marked ? "Mark again" : "Mark this spot",
                    marked ? "Add another mark" : "Save your place");
    return;
  }
  if (row == 2) {
    draw_icon_row_c(ctx, cell, 12, acc, "Change rating", "On second thought");
    return;
  }
  const int n = row - ITEM_ACTIONS;
  if (!w->ready) {
    draw_message_row(ctx, cell, w->status);
    return;
  }
  if (w->count == 0 || n >= w->count) {
    draw_message_row(ctx, cell, "Nothing written yet. Add a note above.");
    return;
  }

  // a note: "Oct 27 @26:00 the guest starts on glaciers", wrapped over up to three lines
  const Entry *en = &w->e[n];
  char text[LABEL_LEN + REF_LEN + 2];
  if (en->ref[0]) snprintf(text, sizeof(text), "%s %s", en->label, en->ref);
  else copy_str(text, sizeof(text), en->label);
  GRect b = layer_get_bounds(cell);
  const bool hi = menu_cell_layer_is_highlighted(cell);
  const bool bare = (en->flags & F_BOOKMARK) != 0;
  const int m = row_margin();
  graphics_context_set_fill_color(ctx, hi ? C_FG : C_BG);
  graphics_fill_rect(ctx, b, 0, GCornerNone);
  if (!hi) {
    graphics_context_set_fill_color(ctx, acc);
    graphics_fill_rect(ctx, GRect(0, 6, 4, b.size.h - 12), 2, GCornersRight);
    graphics_context_set_stroke_color(ctx, C_LINE);
    graphics_draw_line(ctx, GPoint(m, b.size.h - 1), GPoint(b.size.w - m, b.size.h - 1));
  }
  const int tx = m + 4;
  const int tw = b.size.w - tx - m - (bare ? 14 : 0);
  graphics_context_set_text_color(ctx, hi ? C_BG : C_FG);
  graphics_draw_text(ctx, text, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                     GRect(tx, 3, tw, b.size.h - 6), GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  if (bare) {
    draw_ribbon_mark(ctx, b.size.w - m - 5, b.size.h / 2, hi ? C_BG : C_ACC, hi ? C_FG : C_BG);
  }
}

// ---- People: the "Someone new" row, then people you have logged. Select on a person logs that
// you met them (no stars); hold Select to say what you talked about. Row labels from the
// phone look like "Maria Lopez - 5x, Oct 27", so split_label gives the name and a small
// second line.

static void people_draw_row(GContext *ctx, const Layer *cell, int row, ListWin *w) {
  if (row == 0) {
    draw_icon_row_c(ctx, cell, KIND_PEOPLE, kind_color(KIND_PEOPLE), "Someone new", "Say a name");
    return;
  }
  if (!w->ready) {
    draw_message_row(ctx, cell, w->status);
    return;
  }
  if (w->count == 0 || row - 1 >= w->count) {
    draw_message_row(ctx, cell, "No one yet. Say a name above.");
    return;
  }
  const Entry *en = &w->e[row - 1];
  char title[LABEL_LEN], sub[LABEL_LEN];
  split_label(en->label, title, sizeof(title), sub, sizeof(sub));
  GRect b = layer_get_bounds(cell);
  const bool hi = menu_cell_layer_is_highlighted(cell);
  const GColor kc = kind_color(KIND_PEOPLE);
  const int m = row_margin();
  graphics_context_set_fill_color(ctx, hi ? C_FG : C_BG);
  graphics_fill_rect(ctx, b, 0, GCornerNone);
  if (!hi) {
    graphics_context_set_fill_color(ctx, kc);
    graphics_fill_rect(ctx, GRect(0, 6, 4, b.size.h - 12), 2, GCornersRight);
    graphics_context_set_stroke_color(ctx, C_LINE);
    graphics_draw_line(ctx, GPoint(m, b.size.h - 1), GPoint(b.size.w - m, b.size.h - 1));
  }
  const int tx = m + 4;
  const int tw = b.size.w - tx - m;
  graphics_context_set_text_color(ctx, hi ? C_BG : C_FG);
  if (sub[0]) {
    graphics_draw_text(ctx, title, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(tx, 2, tw, 22), GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    graphics_context_set_text_color(ctx, hi ? C_BG : C_MUTE);
    graphics_draw_text(ctx, sub, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                       GRect(tx, 24, tw, 18), GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  } else {
    graphics_draw_text(ctx, title, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(tx, (b.size.h - 22) / 2 - 2, tw, 22), GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  }
}

// After logging someone: a moment later (so a closing dictation screen is out of the way),
// go back to the hub, where the confirmation shows in the header.
static void people_pop_cb(void *data) {
  for (int guard = 0; guard < 8 && window_stack_get_top_window() != s_hub_window; guard++) {
    window_stack_pop(false);
  }
}

static void people_pop(void) {
  vibes_short_pulse();
  app_timer_register(300, people_pop_cb, NULL);
}

static void people_done(const char *name) {
  char msg[32];
  snprintf(msg, sizeof(msg), "Logged %s", name);
  flash_show(msg);
  people_pop();
}


// ---------------------------------------------------------------------------
// One person: Met just now / Add a note / Met, with a note
// ---------------------------------------------------------------------------

static Window *s_pact_window;
static MenuLayer *s_pact_menu;
static char s_pact_ref[REF_LEN];
static char s_pact_title[LABEL_LEN];

static uint16_t pact_rows(MenuLayer *ml, uint16_t section, void *data) { return 3; }
static int16_t pact_header_height(MenuLayer *ml, uint16_t section, void *data) { return 20; }
static int16_t pact_cell_height(MenuLayer *ml, MenuIndex *idx, void *data) { return ROW_H; }

static void pact_draw_header(GContext *ctx, const Layer *cell, uint16_t section, void *data) {
  draw_fancy_header(ctx, cell, s_pact_title, C_ACC);
}

static void pact_draw_row(GContext *ctx, const Layer *cell, MenuIndex *idx, void *data) {
  static const char *const T[3] = { "Met just now", "Add a note", "Met, with a note" };
  static const char *const S[3] = { "counts as a meeting", "no meeting counted", "say what about" };
  static const int ICON[3] = { KIND_PEOPLE, 10, 2 };
  draw_icon_row_c(ctx, cell, ICON[idx->row], kind_color(KIND_PEOPLE), T[idx->row], S[idx->row]);
}

static void pact_select(MenuLayer *ml, MenuIndex *idx, void *data) {
  if (idx->row == 0) {
    queue_log(s_pact_ref, s_pact_title, 0, "", "");   // no stars: the phone records that you met them
    people_done(s_pact_title);
    return;
  }
  copy_str(s_note_ref, sizeof(s_note_ref), s_pact_ref);
  copy_str(s_note_title, sizeof(s_note_title), s_pact_title);
  s_dict_mode = idx->row == 1 ? 5 : 4;
  dictation_session_start(s_dict);
}

static void pact_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_pact_menu = menu_layer_create(layer_get_bounds(root));
  menu_layer_set_callbacks(s_pact_menu, NULL, (MenuLayerCallbacks){
    .get_num_rows = pact_rows,
    .get_header_height = pact_header_height,
    .get_cell_height = pact_cell_height,
    .draw_header = pact_draw_header,
    .draw_row = pact_draw_row,
    .select_click = pact_select,
  });
  menu_layer_set_normal_colors(s_pact_menu, C_BG, C_FG);
  menu_layer_set_highlight_colors(s_pact_menu, C_FG, C_BG);
  menu_layer_set_center_focused(s_pact_menu, false);
  menu_layer_set_click_config_onto_window(s_pact_menu, window);
  layer_add_child(root, menu_layer_get_layer(s_pact_menu));
}

static void pact_unload(Window *window) {
  menu_layer_destroy(s_pact_menu);
  s_pact_menu = NULL;
}

static void pact_push(const char *ref, const char *title) {
  copy_str(s_pact_ref, sizeof(s_pact_ref), ref);
  copy_str(s_pact_title, sizeof(s_pact_title), title);
  window_stack_push(s_pact_window, true);
}

static void people_select(ListWin *w, int row) {
  if (row == 0) {                       // someone not on the list: say who (and what, if you like)
    s_dict_mode = 3;
    dictation_session_start(s_dict);
    return;
  }
  if (!w->ready || row - 1 >= w->count) return;
  const Entry *en = &w->e[row - 1];
  char title[LABEL_LEN], sub[LABEL_LEN];
  split_label(en->label, title, sizeof(title), sub, sizeof(sub));
  pact_push(en->ref, title);   // met just now, a note, or both
}

static void people_long(ListWin *w, int row) {   // hold Select on a person: met them, and say what about
  if (row == 0 || !w->ready || row - 1 >= w->count) return;
  const Entry *en = &w->e[row - 1];
  char sub[LABEL_LEN];
  copy_str(s_note_ref, sizeof(s_note_ref), en->ref);
  split_label(en->label, s_note_title, sizeof(s_note_title), sub, sizeof(sub));
  s_dict_mode = 4;
  dictation_session_start(s_dict);
}

static void list_draw_row(GContext *ctx, const Layer *cell, MenuIndex *idx, void *data) {
  ListWin *w = data;
  if (w->mode == MODE_PEOPLE) {
    people_draw_row(ctx, cell, idx->row, w);
  } else if (w->mode == MODE_ITEM) {
    item_draw_row(ctx, cell, idx->row, w);
  } else if (!w->ready) {
    draw_message_row(ctx, cell, w->status);
  } else if (w->count == 0) {
    draw_message_row(ctx, cell, w->mode == MODE_REFLECT ? "Rate something, then come back to reflect on it."
                                                         : "Nothing found. Try saying it again.");
  } else {
    Entry *en = &w->e[idx->row];
    char title[LABEL_LEN], sub[LABEL_LEN];
    split_label(en->label, title, sizeof(title), sub, sizeof(sub));
    // Reflect's now-playing card (ref "np:<item>", flag F_NOTE = paused): the track, and what a tap does
    const bool now_card = strncmp(en->ref, "np:", 3) == 0;
    if (now_card) {
      copy_str(title, sizeof(title), en->label);
      copy_str(sub, sizeof(sub), (en->flags & F_NOTE) ? "Paused. Tap to mark" : "Now playing. Tap to mark");
    }
    GRect b = layer_get_bounds(cell);
    const bool hi = menu_cell_layer_is_highlighted(cell);
    // entries that carry a ref (the Recent list) get the color of their own kind
    const GColor kc = now_card ? kind_color(KIND_REFLECT) : kind_color(en->ref[0] ? kind_from_ref(en->ref) : w->kind);
    const int m = row_margin();
    const int half = en->flags >> F_STARS_SHIFT;   // rating in half stars, 0 if none
    graphics_context_set_fill_color(ctx, hi ? C_FG : C_BG);
    graphics_fill_rect(ctx, b, 0, GCornerNone);
    if (!hi) {
      graphics_context_set_fill_color(ctx, kc);
      graphics_fill_rect(ctx, GRect(0, 6, 4, b.size.h - 12), 2, GCornersRight);
      graphics_context_set_stroke_color(ctx, C_LINE);
      graphics_draw_line(ctx, GPoint(m, b.size.h - 1), GPoint(b.size.w - m, b.size.h - 1));
    }
    const bool arrow = (en->flags & F_OPEN) != 0 || w->mode == MODE_REFLECT;
    const int tx = m + 4;
    const int tw = b.size.w - tx - m - (arrow ? 12 : 0);
    graphics_context_set_text_color(ctx, hi ? C_BG : C_FG);
    if (half > 0) {
      // rated item (Recent list): title, then its stars
      graphics_draw_text(ctx, en->label, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                         GRect(tx, 3, tw, 22), GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
      draw_stars(ctx, &s_mini, tx + s_mini.hw, 36, 2 * s_mini.hw + 4, half,
                 hi ? C_BG : C_LINE, hi ? C_FG : C_BG);
      if (w->mode == MODE_REFLECT) {   // what you already wrote about it, left of the arrow
        int gx = b.size.w - m - 22;
        if (en->flags & F_BOOKMARK) {
          draw_ribbon_mark(ctx, gx, 36, hi ? C_BG : C_ACC, hi ? C_FG : C_BG);
          gx -= 16;
        }
        if (en->flags & F_NOTE) draw_note_mark(ctx, gx, 36, hi ? C_BG : C_FG);
      }
    } else if (sub[0]) {
      graphics_draw_text(ctx, title, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                         GRect(tx, 2, tw, 22), GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
      graphics_context_set_text_color(ctx, hi ? C_BG : C_MUTE);
      graphics_draw_text(ctx, sub, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                         GRect(tx, 24, tw, 18), GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    } else {
      graphics_draw_text(ctx, title, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                         GRect(tx, (b.size.h - 22) / 2 - 2, tw, 22), GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    }
    if (arrow) {
      const int ax = b.size.w - m - 8, ay = b.size.h / 2;
      graphics_context_set_stroke_color(ctx, hi ? C_BG : kc);
      graphics_context_set_stroke_width(ctx, 2);
      graphics_draw_line(ctx, GPoint(ax, ay - 6), GPoint(ax + 5, ay));
      graphics_draw_line(ctx, GPoint(ax + 5, ay), GPoint(ax, ay + 6));
      graphics_context_set_stroke_width(ctx, 1);
    }
  }
}

static ListWin *list_push(const char *header, bool is_search, int kind);

// The now-playing card at the top of Reflect: mark this spot, then listen for a note about it.
// The phone puts the note on the mark it just made. (en->ref is "np:" + the item's ref.)
static void now_playing_tap(const Entry *en) {
  const char *ref = en->ref + 3;
  char arg[ARG_LEN];
  snprintf(arg, sizeof(arg), "%s|%s", ref, en->label);
  send_request(REQ_MARK, 0, arg, 0);
  copy_str(s_note_ref, sizeof(s_note_ref), ref);
  copy_str(s_note_title, sizeof(s_note_title), en->label);
  s_dict_mode = 2;
  dictation_session_start(s_dict);
}

// Hold Select on a search result: rate it 3 stars straight away and go back to the hub.
static void quick_rate(const char *ref, const char *label) {
  queue_log(ref, label, 6, "", "");
  s_rate_seq++;
  char sub[LABEL_LEN];
  split_label(label, s_just.title, sizeof(s_just.title), sub, sizeof(sub));
  copy_str(s_just.ref, sizeof(s_just.ref), ref);
  s_just.half = 6;
  s_just.on = true;
  if (s_just_timer) app_timer_cancel(s_just_timer);
  s_just_timer = app_timer_register(4000, just_clear, NULL);
  vibes_short_pulse();
  for (int guard = 0; guard < 8 && window_stack_get_top_window() != s_hub_window; guard++) {
    window_stack_pop(false);
  }
}

// Hold Select on a result: pin a show, podcast or album to favorites, or say a bookmark
// for something you can rate (an episode, a song, a movie...).
static void list_long(MenuLayer *ml, MenuIndex *idx, void *data) {
  ListWin *w = data;
  if (w->mode == MODE_ITEM || w->mode == MODE_NOTETO) return;
  if (w->mode == MODE_PEOPLE) {
    people_long(w, idx->row);
    return;
  }
  if (!w->ready || idx->row >= w->count) return;
  Entry *en = &w->e[idx->row];
  if (!en->ref[0]) return;
  if (w->mode == MODE_REFLECT) {   // Reflect: hold Select to say a note about this rating
    if (strncmp(en->ref, "np:", 3) == 0) {   // the now-playing card: same as a tap
      now_playing_tap(en);
      return;
    }
    copy_str(s_note_ref, sizeof(s_note_ref), en->ref);
    copy_str(s_note_title, sizeof(s_note_title), en->label);
    s_dict_mode = 2;
    dictation_session_start(s_dict);
    return;
  }
  if (en->flags & F_OPEN) {
    if (en->ref[1] == ':' && (en->ref[0] == 't' || en->ref[0] == 'p' || en->ref[0] == 'a')) {
      char arg[ARG_LEN];
      snprintf(arg, sizeof(arg), "%s|%s", en->ref, en->label);
      send_request(REQ_PIN, 0, arg, 0);
    }
  } else if (en->flags & F_RATE) {
    if (w->is_search && en->ref[0] != 'x') {   // not "Anything": that one asks for a category first
      quick_rate(en->ref, en->label);
      return;
    }
    copy_str(s_note_ref, sizeof(s_note_ref), en->ref);
    copy_str(s_note_title, sizeof(s_note_title), en->label);
    s_dict_mode = 2;
    dictation_session_start(s_dict);
  }
}

// ---------------------------------------------------------------------------
// Category for an Anything item: say it, pick one you used before, or skip
// ---------------------------------------------------------------------------

#define MAX_TAGS 6

static Window *s_tag_window;
static MenuLayer *s_tag_menu;
static Entry s_tags[MAX_TAGS];
static int s_tag_count;
static int s_tag_token;
static char s_tag_ref[REF_LEN];
static char s_tag_label[LABEL_LEN];
static bool s_tag_to_main;

static uint16_t tag_rows(MenuLayer *ml, uint16_t section, void *data) {
  return s_tag_count + 2;
}

static int16_t tag_header_height(MenuLayer *ml, uint16_t section, void *data) {
  return 20;
}

static int16_t tag_cell_height(MenuLayer *ml, MenuIndex *idx, void *data) {
  return ROW_H;
}

static void tag_draw_header(GContext *ctx, const Layer *cell, uint16_t section, void *data) {
  draw_fancy_header(ctx, cell, "CATEGORY?", kind_color(8));
}

static void tag_draw_row(GContext *ctx, const Layer *cell, MenuIndex *idx, void *data) {
  if (idx->row == 0) {
    draw_icon_row(ctx, cell, 2, "Say a category", "Restaurant, coffee...");
  } else if (idx->row <= s_tag_count) {
    draw_icon_row(ctx, cell, 8, s_tags[idx->row - 1].label, "Used before");
  } else {
    draw_icon_row(ctx, cell, KIND_RECENT, "No category", "Just rate it");
  }
}

// Closes the category screen and opens the rating screen with the chosen tag.
static void tag_finish(const char *tag) {
  char title[LABEL_LEN], sub[LABEL_LEN], label[LABEL_LEN], ref[REF_LEN];
  split_label(s_tag_label, title, sizeof(title), sub, sizeof(sub));
  if (tag && tag[0]) {
    // the rating screen shows the category under the title
    snprintf(label, sizeof(label), "%.*s - %s", (int)(LABEL_LEN - 4 - strlen(tag)), title, tag);
  } else {
    copy_str(label, sizeof(label), s_tag_label);
  }
  copy_str(ref, sizeof(ref), s_tag_ref);
  const bool to_main = s_tag_to_main;
  window_stack_remove(s_tag_window, false);   // not pop: the dictation screen may still be on top
  rate_push(ref, label, to_main);
  copy_str(s_rate_tag, sizeof(s_rate_tag), tag);
}

static void tag_select(MenuLayer *ml, MenuIndex *idx, void *data) {
  if (idx->row == 0) {
    s_dict_mode = 1;
    dictation_session_start(s_dict);
  } else if (idx->row <= s_tag_count) {
    tag_finish(s_tags[idx->row - 1].label);
  } else {
    tag_finish("");
  }
}

static void tag_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_tag_menu = menu_layer_create(layer_get_bounds(root));
  menu_layer_set_callbacks(s_tag_menu, NULL, (MenuLayerCallbacks){
    .get_num_rows = tag_rows,
    .get_header_height = tag_header_height,
    .get_cell_height = tag_cell_height,
    .draw_header = tag_draw_header,
    .draw_row = tag_draw_row,
    .select_click = tag_select,
  });
  menu_layer_set_normal_colors(s_tag_menu, C_BG, C_FG);
  menu_layer_set_highlight_colors(s_tag_menu, C_FG, C_BG);
  menu_layer_set_center_focused(s_tag_menu, false);
  menu_layer_set_click_config_onto_window(s_tag_menu, window);
  layer_add_child(root, menu_layer_get_layer(s_tag_menu));
  s_tag_count = 0;
  s_tag_token = s_next_token++;
  send_request(REQ_TAGS, 0, NULL, s_tag_token);
}

static void tag_unload(Window *window) {
  s_tag_token = 0;
  menu_layer_destroy(s_tag_menu);
  s_tag_menu = NULL;
}

static void tag_push(const char *ref, const char *label, bool to_main) {
  copy_str(s_tag_ref, sizeof(s_tag_ref), ref);
  copy_str(s_tag_label, sizeof(s_tag_label), label);
  s_tag_to_main = to_main;
  window_stack_push(s_tag_window, true);
}


// ---------------------------------------------------------------------------
// Reflect: your latest ratings, and for each one a place for notes and bookmarks.
// Pick a rating to open its page; hold Select on it to say a note straight away.
// ---------------------------------------------------------------------------

// After the phone confirms something ("Saved @26:00", "Bookmarked"), every Reflect page asks
// again so its markers and notes are up to date. Rows are overwritten in place, so the
// highlighted row stays where it is.
static void reflect_refresh(void) {
  for (int i = 0; i < s_list_n; i++) {
    ListWin *w = s_lists[i];
    if (w->mode != MODE_REFLECT && w->mode != MODE_ITEM) continue;
    w->token = s_next_token++;
    w->refresh = w->ready;
    if (w->mode == MODE_REFLECT) send_request(REQ_REFLECT, 0, NULL, w->token);
    else send_request(REQ_NOTES, 0, w->ref, w->token);
  }
}

static void reflect_push(void) {
  ListWin *w = list_push("Reflect: hold = note", false, KIND_REFLECT);
  if (!w) return;
  w->mode = MODE_REFLECT;
  w->token = s_next_token++;
  send_request(REQ_REFLECT, 0, NULL, w->token);
}

static void people_push(void) {
  ListWin *w = list_push("People: hold = note", false, KIND_PEOPLE);
  if (!w) return;
  w->mode = MODE_PEOPLE;
  w->token = s_next_token++;
  send_request(REQ_PEOPLE, 0, NULL, w->token);
}


static void note_push(void) {
  ListWin *w = list_push("Note about...", false, KIND_REFLECT);
  if (!w) return;
  w->mode = MODE_NOTETO;
  w->token = s_next_token++;
  send_request(REQ_TARGETS, 0, NULL, w->token);
}

static void note_pick(const Entry *en) {
  char title[LABEL_LEN], sub[LABEL_LEN];
  split_label(en->label, title, sizeof(title), sub, sizeof(sub));
  copy_str(s_note_ref, sizeof(s_note_ref), en->ref);
  copy_str(s_note_title, sizeof(s_note_title), title);
  s_dict_mode = 5;
  dictation_session_start(s_dict);
}

// One rating's page: what you wrote about it, and what you can do with it.
static void item_push(const Entry *en) {
  char title[LABEL_LEN], sub[LABEL_LEN];
  split_label(en->label, title, sizeof(title), sub, sizeof(sub));
  ListWin *w = list_push(title, false, KIND_REFLECT);
  if (!w) return;
  w->mode = MODE_ITEM;
  w->half = en->flags >> F_STARS_SHIFT;
  w->rated_seq = s_rate_seq;
  copy_str(w->ref, sizeof(w->ref), en->ref);
  copy_str(w->title, sizeof(w->title), en->label);
  w->token = s_next_token++;
  send_request(REQ_NOTES, 0, w->ref, w->token);
}

static void item_select(ListWin *w, int row) {
  if (row == 0) {          // say a note (the phone pulls out a time or page if you say one)
    copy_str(s_note_ref, sizeof(s_note_ref), w->ref);
    copy_str(s_note_title, sizeof(s_note_title), w->title);
    s_dict_mode = 2;
    dictation_session_start(s_dict);
  } else if (row == 1) {   // mark this spot (each press adds a new mark)
    char arg[ARG_LEN];
    snprintf(arg, sizeof(arg), "%s|%s", w->ref, w->title);
    send_request(REQ_MARK, 0, arg, 0);
  } else if (row == 2) {   // change the stars; the rating screen brings you back here
    rate_push_at(w->ref, w->title, false, w->half);
  }
}

// Comes back into view: Reflect re-asks (a note or re-rating may have changed things), and a
// rating's page picks up new stars if you changed them.
static void list_appear(Window *window) {
  ListWin *w = window_get_user_data(window);
  if (!w->seen) {
    w->seen = true;
    return;
  }
  if (w->mode == MODE_REFLECT) {
    w->token = s_next_token++;
    w->refresh = w->ready;
    send_request(REQ_REFLECT, 0, NULL, w->token);
  } else if (w->mode == MODE_ITEM && w->rated_seq != s_rate_seq) {
    w->rated_seq = s_rate_seq;
    if (strcmp(s_just.ref, w->ref) == 0) w->half = s_just.half;
    list_reload(w);
  }
}

static void list_select(MenuLayer *ml, MenuIndex *idx, void *data) {
  ListWin *w = data;
  if (w->mode == MODE_ITEM) {
    item_select(w, idx->row);
    return;
  }
  if (w->mode == MODE_PEOPLE) {
    people_select(w, idx->row);
    return;
  }
  if (!w->ready || idx->row >= w->count) return;
  Entry *en = &w->e[idx->row];
  if (w->mode == MODE_NOTETO) {
    note_pick(en);
    return;
  }
  if (w->mode == MODE_REFLECT) {
    if (strncmp(en->ref, "np:", 3) == 0) now_playing_tap(en);   // the now-playing card
    else item_push(en);
    return;
  }
  if (en->flags & F_OPEN) {
    ListWin *child = list_push(en->label, false, w->kind);
    if (child) {
      child->token = s_next_token++;
      send_request(REQ_BROWSE, 0, en->ref, child->token);
    }
  } else if (en->flags & F_RATE) {
    if (en->ref[0] == 'x') tag_push(en->ref, en->label, w->is_search);   // Anything: ask for a category
    else rate_push(en->ref, en->label, w->is_search);
  }
}

static void list_timeout(void *data) {
  ListWin *w = data;
  w->timeout = NULL;
  if (!w->ready) {
    copy_str(w->status, sizeof(w->status), "No answer. Phone nearby?");
    list_reload(w);
  }
}

static void list_load(Window *window) {
  ListWin *w = window_get_user_data(window);
  Layer *root = window_get_root_layer(window);
  w->menu = menu_layer_create(layer_get_bounds(root));
  menu_layer_set_callbacks(w->menu, w, (MenuLayerCallbacks){
    .get_num_rows = list_rows,
    .get_header_height = list_header_height,
    .get_cell_height = list_cell_height,
    .draw_header = list_draw_header,
    .draw_row = list_draw_row,
    .select_click = list_select,
    .select_long_click = list_long,
  });
  menu_layer_set_normal_colors(w->menu, C_BG, C_FG);
  menu_layer_set_highlight_colors(w->menu, C_FG, C_BG);
  menu_layer_set_center_focused(w->menu, false);
  menu_layer_set_click_config_onto_window(w->menu, window);
  layer_add_child(root, menu_layer_get_layer(w->menu));
}

// The window is destroyed a moment after it unloads, never from inside its own
// unload handler.
static void list_free(void *data) {
  ListWin *w = data;
  window_destroy(w->window);
  free(w);
}

static void list_unload(Window *window) {
  ListWin *w = window_get_user_data(window);
  if (w->timeout) {
    app_timer_cancel(w->timeout);
    w->timeout = NULL;
  }
  menu_layer_destroy(w->menu);
  w->menu = NULL;
  for (int i = 0; i < s_list_n; i++) {
    if (s_lists[i] == w) {
      for (int j = i; j < s_list_n - 1; j++) s_lists[j] = s_lists[j + 1];
      s_list_n--;
      break;
    }
  }
  app_timer_register(0, list_free, w);
}

static ListWin *list_push(const char *header, bool is_search, int kind) {
  if (s_list_n >= MAX_DEPTH) return NULL;
  ListWin *w = calloc(1, sizeof(ListWin) + sizeof(Entry) * MAX_ENTRIES);
  if (!w) return NULL;
  w->e = (Entry *)(w + 1);
  w->is_search = is_search;
  w->kind = kind;
  copy_str(w->header, sizeof(w->header), header);
  copy_str(w->status, sizeof(w->status), "Asking your phone...");
  w->window = window_create();
  window_set_background_color(w->window, C_BG);
  window_set_user_data(w->window, w);
  window_set_window_handlers(w->window, (WindowHandlers){
    .load = list_load,
    .unload = list_unload,
    .appear = list_appear,
  });
  s_lists[s_list_n++] = w;
  window_stack_push(w->window, true);
  w->timeout = app_timer_register(LIST_TIMEOUT_MS, list_timeout, w);
  return w;
}

// ---------------------------------------------------------------------------
// Full menu (Home's Down button): continue, log by kind, recent
// ---------------------------------------------------------------------------

#define MAX_FAVS 8
static Entry s_favs[MAX_FAVS];
static int s_fav_count;
static int s_fav_token;

enum { SEC_FAV, SEC_CONT, SEC_LOG };

// Sections only exist when they have something in them.
static int main_sec_id(int section) {
  int n = 0;
  if (s_fav_count > 0) { if (section == n) return SEC_FAV; n++; }
  if (s_cont_count > 0) { if (section == n) return SEC_CONT; n++; }
  return SEC_LOG;
}

static uint16_t main_sections(MenuLayer *ml, void *data) {
  return 1 + (s_fav_count > 0 ? 1 : 0) + (s_cont_count > 0 ? 1 : 0);
}

static uint16_t main_rows(MenuLayer *ml, uint16_t section, void *data) {
  switch (main_sec_id(section)) {
    case SEC_FAV: return s_fav_count;
    case SEC_CONT: return s_cont_count;
    default: return KIND_COUNT + 3;   // the kinds, Recent, Reflect, Bookmarks
  }
}

static int16_t main_header_height(MenuLayer *ml, uint16_t section, void *data) {
  return 20;
}

static int16_t main_cell_height(MenuLayer *ml, MenuIndex *idx, void *data) {
  return ROW_H;
}

static void main_draw_header(GContext *ctx, const Layer *cell, uint16_t section, void *data) {
  const int id = main_sec_id(section);
  draw_fancy_header(ctx, cell, id == SEC_FAV ? "FAVORITES" : (id == SEC_CONT ? "CONTINUE" : "LOG SOMETHING"), C_ACC);
}

static void main_draw_row(GContext *ctx, const Layer *cell, MenuIndex *idx, void *data) {
  const int id = main_sec_id(idx->section);
  if (id == SEC_FAV) {
    draw_icon_row(ctx, cell, kind_from_ref(s_favs[idx->row].ref), s_favs[idx->row].label, "Open");
  } else if (id == SEC_CONT) {
    draw_icon_row(ctx, cell, 1, s_cont[idx->row].label, "Next up");
  } else if (idx->row < KIND_COUNT) {
    const int k = MENU_KINDS[idx->row];
    draw_icon_row(ctx, cell, k, KIND_NAMES[k], KIND_PROMPTS[k]);
  } else if (idx->row == KIND_COUNT) {
    draw_icon_row(ctx, cell, KIND_RECENT, "Recent", "Your latest ratings");
  } else if (idx->row == KIND_COUNT + 1) {
    draw_icon_row(ctx, cell, 10, "Reflect", "Notes on your ratings");
  } else {
    draw_icon_row(ctx, cell, 4, "Bookmarks", "Where you left off");
  }
}

static void main_select(MenuLayer *ml, MenuIndex *idx, void *data) {
  const int id = main_sec_id(idx->section);
  if (id == SEC_FAV) {
    ListWin *w = list_push(s_favs[idx->row].label, false, kind_from_ref(s_favs[idx->row].ref));
    if (w) {
      w->token = s_next_token++;
      send_request(REQ_BROWSE, 0, s_favs[idx->row].ref, w->token);
    }
  } else if (id == SEC_CONT) {
    rate_push(s_cont[idx->row].ref, s_cont[idx->row].label, true);
  } else if (idx->row < KIND_COUNT) {
    s_search_kind = MENU_KINDS[idx->row];
    s_dict_mode = 0;
    dictation_session_start(s_dict);
  } else if (idx->row == KIND_COUNT) {
    ListWin *w = list_push("Recent", false, KIND_RECENT);
    if (w) {
      w->token = s_next_token++;
      send_request(REQ_RECENT, 0, NULL, w->token);
    }
  } else if (idx->row == KIND_COUNT + 1) {
    reflect_push();
  } else {
    ListWin *w = list_push("Bookmarks", false, 4);
    if (w) {
      w->token = s_next_token++;
      send_request(REQ_MARKS, 0, NULL, w->token);
    }
  }
}

static void fav_refresh(void) {
  s_fav_token = s_next_token++;
  send_request(REQ_FAVS, 0, NULL, s_fav_token);
}

// Hold Select on a favorite to unpin it.
static void main_long(MenuLayer *ml, MenuIndex *idx, void *data) {
  if (main_sec_id(idx->section) != SEC_FAV) return;
  char arg[ARG_LEN];
  snprintf(arg, sizeof(arg), "%s|%s", s_favs[idx->row].ref, s_favs[idx->row].label);
  send_request(REQ_PIN, 0, arg, 0);
  fav_refresh();
}

static void main_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_main_menu = menu_layer_create(layer_get_bounds(root));
  menu_layer_set_callbacks(s_main_menu, NULL, (MenuLayerCallbacks){
    .get_num_sections = main_sections,
    .get_num_rows = main_rows,
    .get_header_height = main_header_height,
    .get_cell_height = main_cell_height,
    .draw_header = main_draw_header,
    .draw_row = main_draw_row,
    .select_click = main_select,
    .select_long_click = main_long,
  });
  menu_layer_set_normal_colors(s_main_menu, C_BG, C_FG);
  menu_layer_set_highlight_colors(s_main_menu, C_FG, C_BG);
  menu_layer_set_center_focused(s_main_menu, false);
  menu_layer_set_click_config_onto_window(s_main_menu, window);
  layer_add_child(root, menu_layer_get_layer(s_main_menu));
  fav_refresh();
}

static void main_unload(Window *window) {
  menu_layer_destroy(s_main_menu);
  s_main_menu = NULL;
}

// ---------------------------------------------------------------------------
// Small parsing helpers for the packed stats the phone sends
// ---------------------------------------------------------------------------

// Reads whitespace-separated integers; anything else inside a token is skipped.
static int parse_ints(const char *s, int *out, int max) {
  int n = 0;
  while (*s && n < max) {
    while (*s == ' ') s++;
    if (!*s) break;
    bool neg = false;
    if (*s == '-') { neg = true; s++; }
    int v = 0;
    while (*s >= '0' && *s <= '9') { v = v * 10 + (*s - '0'); s++; }
    out[n++] = neg ? -v : v;
    while (*s && *s != ' ') s++;
  }
  return n;
}

// One character holds 0 to 35: digits, then lowercase letters.
static int b36_val(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'z') return 10 + (c - 'a');
  return 0;
}

// ---------------------------------------------------------------------------
// Stats pages: five screens, Up/Down to page, Select to change the range
// ---------------------------------------------------------------------------

#define ST_PAGES 5
#define ST_RANGES 4
#define MAX_BARS 12
#define MAX_KSTATS 7
#define HEAT_DAYS 84
#define HEAT_WEEKS 12

typedef struct { char letter; int n; int avg10; } KindStat;
typedef struct { char title[LABEL_LEN]; char ref[REF_LEN]; int half; } Pick;

typedef struct {
  bool ready;
  int n, avg10, prev_n, prev_avg10, streak, best;
  int nbars;
  uint8_t bar[MAX_BARS];
  char barlab[MAX_BARS][5];
  uint8_t heat[HEAT_DAYS];
  uint8_t hist[10];
  char common[28];
  char tone[20];
  int nk;
  KindStat kind[MAX_KSTATS];
  int ntop;
  Pick top[3];
  bool has_low;
  Pick low;
} StatsData;

static const char *const RANGE_SHORT[ST_RANGES] = { "WEEK", "MONTH", "YEAR", "ALL" };
static const char *const RANGE_PREV[ST_RANGES] = { "prior 7 days", "prior 30 days", "prior year", "" };
static const char *const KIND_PLURAL[KIND_COUNT] = {
  "Movies", "TV", "Podcasts", "Albums", "Books", "Songs", "Games", "Recipes", "Other"
};
static const char *const PAGE_TITLES[ST_PAGES] = { "OVERVIEW", "LAST 12 WEEKS", "BY KIND", "HOW YOU RATE", "HIGHLIGHTS" };

static Window *s_stats_window;
static Layer *s_stats_layer;
static StatsData s_st;
static int s_stats_page;
static int s_stats_range = 1;      // month
static int s_stats_token;
static char s_stats_status[36];
static AppTimer *s_stats_timeout;
static int s_anim = 100;          // bar growth, percent
static AppTimer *s_anim_timer;

static void stats_fill_pick(Pick *p, const Entry *en) {
  copy_str(p->title, sizeof(p->title), en->label);
  copy_str(p->ref, sizeof(p->ref), en->ref);
  p->half = en->flags >> F_STARS_SHIFT;
}

static void stats_parse_kinds(const char *s) {
  while (*s && s_st.nk < MAX_KSTATS) {
    while (*s == ' ') s++;
    if (!*s) break;
    KindStat *k = &s_st.kind[s_st.nk];
    k->letter = *s++;
    int v = 0;
    while (*s >= '0' && *s <= '9') { v = v * 10 + (*s - '0'); s++; }
    k->n = v;
    if (*s == ',') s++;
    v = 0;
    while (*s >= '0' && *s <= '9') { v = v * 10 + (*s - '0'); s++; }
    k->avg10 = v;
    s_st.nk++;
  }
}

// Entry types come in the low four bits of the flags (see watchEntries in stats.js).
static void stats_ingest(int idx, const Entry *en) {
  if (idx == 0) memset(&s_st, 0, sizeof(s_st));
  switch (en->flags & 15) {
    case 1: {   // overview: numbers in the label, bars in the ref ("heights/labels")
      int v[6] = { 0, 0, -1, -1, 0, 0 };
      parse_ints(en->label, v, 6);
      s_st.n = v[0]; s_st.avg10 = v[1]; s_st.prev_n = v[2]; s_st.prev_avg10 = v[3];
      s_st.streak = v[4]; s_st.best = v[5];
      const char *slash = strchr(en->ref, '/');
      if (slash) {
        int nb = 0;
        for (const char *p = en->ref; p < slash && nb < MAX_BARS; p++) s_st.bar[nb++] = (uint8_t)b36_val(*p);
        s_st.nbars = nb;
        const char *l = slash + 1;
        for (int i = 0; i < nb; i++) {
          int k = 0;
          while (*l && *l != ',' && k < 4) s_st.barlab[i][k++] = *l++;
          s_st.barlab[i][k] = '\0';
          while (*l && *l != ',') l++;
          if (*l == ',') l++;
        }
      }
      break;
    }
    case 2: {   // heat map: two days per character, label then ref
      int di = 0;
      const char *parts[2] = { en->label, en->ref };
      for (int j = 0; j < 2; j++) {
        for (const char *c = parts[j]; *c; c++) {
          int v = b36_val(*c);
          if (di < HEAT_DAYS) s_st.heat[di++] = (uint8_t)(v / 6);
          if (di < HEAT_DAYS) s_st.heat[di++] = (uint8_t)(v % 6);
        }
      }
      break;
    }
    case 3: {   // histogram in the label, "common|tone" in the ref
      for (int i = 0; i < 10 && en->label[i]; i++) s_st.hist[i] = (uint8_t)b36_val(en->label[i]);
      const char *bar = strchr(en->ref, '|');
      if (bar) {
        size_t n = (size_t)(bar - en->ref);
        if (n >= sizeof(s_st.common)) n = sizeof(s_st.common) - 1;
        memcpy(s_st.common, en->ref, n);
        s_st.common[n] = '\0';
        copy_str(s_st.tone, sizeof(s_st.tone), bar + 1);
      } else {
        copy_str(s_st.common, sizeof(s_st.common), en->ref);
      }
      break;
    }
    case 4:
      stats_parse_kinds(en->label);
      stats_parse_kinds(en->ref);
      break;
    case 5:
      if (s_st.ntop < 3) stats_fill_pick(&s_st.top[s_st.ntop++], en);
      break;
    case 6:
      stats_fill_pick(&s_st.low, en);
      s_st.has_low = true;
      break;
  }
}

static void anim_step(void *data) {
  s_anim_timer = NULL;
  s_anim += 25;
  if (s_anim > 100) s_anim = 100;
  if (s_stats_layer) layer_mark_dirty(s_stats_layer);
  if (s_anim < 100) s_anim_timer = app_timer_register(45, anim_step, NULL);
}

static void anim_start(void) {
  if (s_anim_timer) app_timer_cancel(s_anim_timer);
  s_anim = 0;
  s_anim_timer = app_timer_register(45, anim_step, NULL);
}

static void stats_timeout(void *data) {
  s_stats_timeout = NULL;
  if (!s_st.ready) {
    copy_str(s_stats_status, sizeof(s_stats_status), "No answer. Phone nearby?");
    if (s_stats_layer) layer_mark_dirty(s_stats_layer);
  }
}

static void stats_request(void) {
  s_st.ready = false;
  copy_str(s_stats_status, sizeof(s_stats_status), "Asking your phone...");
  s_stats_token = s_next_token++;
  if (s_stats_timeout) app_timer_cancel(s_stats_timeout);
  s_stats_timeout = app_timer_register(LIST_TIMEOUT_MS, stats_timeout, NULL);
  send_request(REQ_STATS, s_stats_range, NULL, s_stats_token);
  if (s_stats_layer) layer_mark_dirty(s_stats_layer);
}

#define ST_CW 184   // content width; the page dots live in the strip to the right

static void st_text(GContext *ctx, const char *s, const char *font, GRect r, GTextAlignment al, GColor c) {
  graphics_context_set_text_color(ctx, c);
  graphics_draw_text(ctx, s, fonts_get_system_font(font), r, GTextOverflowModeTrailingEllipsis, al, NULL);
}

static void st_header(GContext *ctx, int page) {
  st_text(ctx, PAGE_TITLES[page], FONT_KEY_GOTHIC_14_BOLD, GRect(8, -1, 130, 18), GTextAlignmentLeft, C_ACC);
  graphics_context_set_stroke_color(ctx, C_ACC);
  graphics_draw_line(ctx, GPoint(8, 20), GPoint(ST_CW, 20));
  if (page != 1) {   // the activity grid always shows the last 12 weeks
    graphics_context_set_fill_color(ctx, C_ACC);
    graphics_fill_rect(ctx, GRect(ST_CW - 48, 2, 48, 16), 8, GCornersAll);
    st_text(ctx, RANGE_SHORT[s_stats_range], FONT_KEY_GOTHIC_14_BOLD, GRect(ST_CW - 48, -1, 48, 18),
            GTextAlignmentCenter, C_BG);
  }
}

static void st_dots(GContext *ctx, int page, int h) {
  const int top = h / 2 - (ST_PAGES * 10) / 2;
  for (int i = 0; i < ST_PAGES; i++) {
    const GPoint c = GPoint(192, top + i * 10 + 5);
    if (i == page) {
      graphics_context_set_fill_color(ctx, C_FG);
      graphics_fill_circle(ctx, c, 3);
    } else {
      graphics_context_set_fill_color(ctx, C_LINE);
      graphics_fill_circle(ctx, c, 2);
    }
  }
}

static void st_page_overview(GContext *ctx) {
  char buf[32];
  snprintf(buf, sizeof(buf), "%d.%d", s_st.avg10 / 10, s_st.avg10 % 10);
  st_text(ctx, s_st.n ? buf : "-", FONT_KEY_GOTHIC_28_BOLD, GRect(8, 20, 84, 34), GTextAlignmentLeft, C_ACC);
  st_text(ctx, "average", FONT_KEY_GOTHIC_14, GRect(96, 24, 86, 16), GTextAlignmentLeft, C_MUTE);
  snprintf(buf, sizeof(buf), "%d rated", s_st.n);
  st_text(ctx, buf, FONT_KEY_GOTHIC_18_BOLD, GRect(96, 37, 86, 22), GTextAlignmentLeft, C_FG);

  if (s_st.prev_n >= 0 && RANGE_PREV[s_stats_range][0]) {
    const int d = s_st.n - s_st.prev_n;
    if (d > 0) snprintf(buf, sizeof(buf), "+%d vs %s", d, RANGE_PREV[s_stats_range]);
    else if (d < 0) snprintf(buf, sizeof(buf), "%d vs %s", d, RANGE_PREV[s_stats_range]);
    else snprintf(buf, sizeof(buf), "same as %s", RANGE_PREV[s_stats_range]);
    st_text(ctx, buf, FONT_KEY_GOTHIC_14_BOLD, GRect(8, 58, ST_CW - 8, 16), GTextAlignmentLeft,
            d > 0 ? C_OK : (d < 0 ? C_WARN : C_MUTE));
  }

  // bars: how many things you rated in each stretch of time
  const int base = 150, maxh = 60;
  const int nb = s_st.nbars > 0 ? s_st.nbars : 1;
  const int slot = (ST_CW - 16) / nb;
  int bw = slot - 4;
  if (bw > 22) bw = 22;
  for (int i = 0; i < s_st.nbars; i++) {
    const int cx = 8 + slot * i + slot / 2;
    int h = s_st.bar[i] * maxh / 35 * s_anim / 100;
    if (s_st.bar[i] > 0 && h < 3) h = 3;
    if (h > 0) {
      graphics_context_set_fill_color(ctx, i == s_st.nbars - 1 ? C_FG : C_ACC);
      graphics_fill_rect(ctx, GRect(cx - bw / 2, base - h, bw, h), 2, GCornersTop);
    } else {
      graphics_context_set_fill_color(ctx, C_LINE);
      graphics_fill_rect(ctx, GRect(cx - bw / 2, base - 2, bw, 2), 0, GCornerNone);
    }
    st_text(ctx, s_st.barlab[i], FONT_KEY_GOTHIC_14, GRect(cx - slot / 2, base + 1, slot, 16),
            GTextAlignmentCenter, i == s_st.nbars - 1 ? C_FG : C_MUTE);
  }
  graphics_context_set_stroke_color(ctx, C_LINE);
  graphics_draw_line(ctx, GPoint(8, 174), GPoint(ST_CW, 174));

  if (s_st.streak > 0) snprintf(buf, sizeof(buf), "%d day streak, best %d", s_st.streak, s_st.best);
  else snprintf(buf, sizeof(buf), "No streak yet, best %d", s_st.best);
  st_text(ctx, buf, FONT_KEY_GOTHIC_14_BOLD, GRect(8, 178, ST_CW - 8, 18), GTextAlignmentLeft, C_FG);
  st_text(ctx, "Select: change range", FONT_KEY_GOTHIC_14, GRect(8, 198, ST_CW - 8, 18), GTextAlignmentLeft, C_MUTE);
}

static GColor heat_color(int level) {
  switch (level) {
    case 1: return GColorMintGreen;
    case 2: return GColorKellyGreen;
    case 3: return GColorIslamicGreen;
    case 4: return GColorDarkGreen;
    default: return C_LINE;
  }
}

static void st_page_activity(GContext *ctx) {
  const int cell = 13, gap = 2;
  const int x0 = 6, y0 = 28;
  int active = 0;
  for (int i = 0; i < HEAT_DAYS; i++) {
    const int lv = s_st.heat[i];
    if (lv >= 1 && lv <= 4) active++;
    if (lv > 4) continue;   // a day still to come
    const int col = i / 7, row = i % 7;
    graphics_context_set_fill_color(ctx, heat_color(lv));
    graphics_fill_rect(ctx, GRect(x0 + col * (cell + gap), y0 + row * (cell + gap), cell, cell), 2, GCornersAll);
  }
  char buf[32];
  snprintf(buf, sizeof(buf), "%d day streak", s_st.streak);
  st_text(ctx, buf, FONT_KEY_GOTHIC_28_BOLD, GRect(8, 136, ST_CW - 8, 34), GTextAlignmentLeft,
          s_st.streak > 0 ? C_ACC : C_MUTE);
  snprintf(buf, sizeof(buf), "Best: %d days", s_st.best);
  st_text(ctx, buf, FONT_KEY_GOTHIC_18, GRect(8, 168, ST_CW - 8, 22), GTextAlignmentLeft, C_FG);
  snprintf(buf, sizeof(buf), "%d active days of %d", active, HEAT_DAYS);
  st_text(ctx, buf, FONT_KEY_GOTHIC_14, GRect(8, 192, ST_CW - 8, 18), GTextAlignmentLeft, C_MUTE);
}

static void st_page_kinds(GContext *ctx) {
  if (s_st.nk == 0) {
    st_text(ctx, "Nothing rated in this range yet.", FONT_KEY_GOTHIC_18, GRect(8, 40, ST_CW - 8, 60), GTextAlignmentLeft, C_MUTE);
    return;
  }
  int max = 1;
  for (int i = 0; i < s_st.nk; i++) if (s_st.kind[i].n > max) max = s_st.kind[i].n;
  for (int i = 0; i < s_st.nk; i++) {
    const KindStat *k = &s_st.kind[i];
    char lt[2] = { k->letter, '\0' };
    const int kind = kind_from_ref(lt);
    const int y = 26 + i * 24;
    st_text(ctx, kind < KIND_COUNT ? KIND_PLURAL[kind] : "Other", FONT_KEY_GOTHIC_14_BOLD,
            GRect(8, y + 1, 66, 18), GTextAlignmentLeft, C_FG);
    int w = k->n * 54 / max;
    if (w < 3) w = 3;
    graphics_context_set_fill_color(ctx, kind_color(kind));
    graphics_fill_rect(ctx, GRect(74, y + 5, w, 10), 3, GCornersAll);
    char buf[16];
    snprintf(buf, sizeof(buf), "%d  %d.%d", k->n, k->avg10 / 10, k->avg10 % 10);
    st_text(ctx, buf, FONT_KEY_GOTHIC_14, GRect(ST_CW - 56, y + 1, 56, 18), GTextAlignmentRight, C_MUTE);
  }
}

static void st_page_hist(GContext *ctx) {
  const int base = 112, maxh = 70, slot = 17;
  int mode = 0;
  for (int i = 1; i < 10; i++) if (s_st.hist[i] > s_st.hist[mode]) mode = i;
  for (int i = 0; i < 10; i++) {
    const int cx = 8 + 2 + slot * i + slot / 2;
    int h = s_st.hist[i] * maxh / 35 * s_anim / 100;
    if (s_st.hist[i] > 0 && h < 3) h = 3;
    if (h > 0) {
      graphics_context_set_fill_color(ctx, (i == mode) ? C_FG : C_ACC);
      graphics_fill_rect(ctx, GRect(cx - 6, base - h, 12, h), 2, GCornersTop);
    } else {
      graphics_context_set_fill_color(ctx, C_LINE);
      graphics_fill_rect(ctx, GRect(cx - 6, base - 2, 12, 2), 0, GCornerNone);
    }
    if (i & 1) {   // the whole-star buckets get a label: 1, 2, 3, 4, 5
      char lb[2] = { (char)('1' + i / 2), '\0' };
      st_text(ctx, lb, FONT_KEY_GOTHIC_14, GRect(cx - 9 - slot / 2, base + 1, slot * 2, 16), GTextAlignmentCenter, C_MUTE);
    }
  }
  st_text(ctx, "stars", FONT_KEY_GOTHIC_14, GRect(8, base + 16, 60, 16), GTextAlignmentLeft, C_LINE);
  st_text(ctx, s_st.common, FONT_KEY_GOTHIC_18_BOLD, GRect(8, 148, ST_CW - 8, 24), GTextAlignmentLeft, C_FG);
  st_text(ctx, s_st.tone, FONT_KEY_GOTHIC_18, GRect(8, 174, ST_CW - 8, 24), GTextAlignmentLeft, C_ACC);
}

static void st_pick_row(GContext *ctx, const Pick *p, int y) {
  const GColor kc = kind_color(kind_from_ref(p->ref));
  graphics_context_set_fill_color(ctx, kc);
  graphics_fill_rect(ctx, GRect(0, y + 6, 4, 28), 2, GCornersRight);
  st_text(ctx, p->title, FONT_KEY_GOTHIC_18_BOLD, GRect(10, y, ST_CW - 12, 22), GTextAlignmentLeft, C_FG);
  draw_stars(ctx, &s_mini, 10 + s_mini.hw, y + 31, 2 * s_mini.hw + 4, p->half, C_LINE, C_BG);
}

static void st_page_highlights(GContext *ctx) {
  if (s_st.ntop == 0) {
    st_text(ctx, "Rate something to see your highlights.", FONT_KEY_GOTHIC_18, GRect(8, 40, ST_CW - 8, 60), GTextAlignmentLeft, C_MUTE);
    return;
  }
  int y = 26;
  for (int i = 0; i < s_st.ntop; i++) {
    st_pick_row(ctx, &s_st.top[i], y);
    y += 42;
  }
  if (s_st.has_low) {
    st_text(ctx, "LOWEST", FONT_KEY_GOTHIC_14_BOLD, GRect(8, y - 2, 100, 18), GTextAlignmentLeft, C_WARN);
    st_pick_row(ctx, &s_st.low, y + 16);
  }
}

static void stats_update(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  graphics_context_set_fill_color(ctx, C_BG);
  graphics_fill_rect(ctx, b, 0, GCornerNone);
  st_header(ctx, s_stats_page);
  st_dots(ctx, s_stats_page, b.size.h);
  if (!s_st.ready) {
    st_text(ctx, s_stats_status, FONT_KEY_GOTHIC_18, GRect(8, 60, ST_CW - 8, 60), GTextAlignmentLeft, C_MUTE);
    return;
  }
  switch (s_stats_page) {
    case 0: st_page_overview(ctx); break;
    case 1: st_page_activity(ctx); break;
    case 2: st_page_kinds(ctx); break;
    case 3: st_page_hist(ctx); break;
    default: st_page_highlights(ctx); break;
  }
}

static void stats_up(ClickRecognizerRef rec, void *ctx) {
  if (s_stats_page > 0) { s_stats_page--; anim_start(); }
}

static void stats_down(ClickRecognizerRef rec, void *ctx) {
  if (s_stats_page < ST_PAGES - 1) { s_stats_page++; anim_start(); }
}

static void stats_select(ClickRecognizerRef rec, void *ctx) {
  if (s_stats_page == 1) return;   // the activity grid doesn't depend on the range
  s_stats_range = (s_stats_range + 1) % ST_RANGES;
  stats_request();
}

static void stats_click_config(void *ctx) {
  window_single_click_subscribe(BUTTON_ID_UP, stats_up);
  window_single_click_subscribe(BUTTON_ID_DOWN, stats_down);
  window_single_click_subscribe(BUTTON_ID_SELECT, stats_select);
}

static void stats_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_stats_layer = layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_stats_layer, stats_update);
  layer_add_child(root, s_stats_layer);
  stats_request();
}

static void stats_unload(Window *window) {
  if (s_stats_timeout) {
    app_timer_cancel(s_stats_timeout);
    s_stats_timeout = NULL;
  }
  if (s_anim_timer) {
    app_timer_cancel(s_anim_timer);
    s_anim_timer = NULL;
  }
  s_stats_token = 0;   // late replies are ignored
  layer_destroy(s_stats_layer);
  s_stats_layer = NULL;
}

static void stats_push(void) {
  s_stats_page = 0;
  window_stack_push(s_stats_window, true);
}

// ---------------------------------------------------------------------------
// Home: your day at a glance, with the three buttons on the right edge
// ---------------------------------------------------------------------------

#define BAR_W 0
#define HOME_ROW_H 40
#define NEXT_ROW_H 38
#define HOME_ROWS 3

static const char *const DAY_NAMES[7] = { "SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT" };
static const char *const MONTH_NAMES[12] = { "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC" };

typedef struct {
  const char *title;
  const char *ref;
  int half;
} HomeRow;

// Today's rated items: the one you just saved first (it is on screen before the phone
// has confirmed it), then what the phone listed.
static int home_collect(HomeRow *rows, int max) {
  int n = 0;
  if (s_just.on && n < max) {
    rows[n].title = s_just.title;
    rows[n].ref = s_just.ref;
    rows[n].half = s_just.half;
    n++;
  }
  for (int i = 0; i < s_home_count && n < max; i++) {
    const Entry *en = &s_home[i];
    if ((en->flags & 15) != 2) continue;
    if (s_just.on && strcmp(en->ref, s_just.ref) == 0) continue;
    rows[n].title = en->label;
    rows[n].ref = en->ref;
    rows[n].half = en->flags >> F_STARS_SHIFT;
    n++;
  }
  return n;
}

static void home_update(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  const int cw = b.size.w - BAR_W;
  graphics_context_set_fill_color(ctx, C_BG);
  graphics_fill_rect(ctx, b, 0, GCornerNone);

  // header: today's date
  time_t now = time(NULL);
  struct tm *t = localtime(&now);
  char head[32];
  snprintf(head, sizeof(head), "TODAY, %s %s %d", DAY_NAMES[t->tm_wday % 7], MONTH_NAMES[t->tm_mon % 12], t->tm_mday);
  st_text(ctx, head, FONT_KEY_GOTHIC_14_BOLD, GRect(8, -1, cw - 10, 18), GTextAlignmentLeft, C_ACC);
  graphics_context_set_stroke_color(ctx, C_ACC);
  graphics_draw_line(ctx, GPoint(8, 20), GPoint(cw - 6, 20));

  // summary line from the phone
  const char *summary = "";
  for (int i = 0; i < s_home_count; i++) {
    if ((s_home[i].flags & 15) == 1) { summary = s_home[i].label; break; }
  }
  int streak = 0;
  for (int i = 0; i < s_home_count; i++) {
    if ((s_home[i].flags & 15) == 4) streak = atoi(s_home[i].label);
  }
  HomeRow rows[HOME_ROWS];
  const int n = home_collect(rows, HOME_ROWS);
  char nudge[32];
  const bool nag = (n == 0 && streak > 0 && t->tm_hour >= 17);   // evening, nothing logged yet
  if (nag) snprintf(nudge, sizeof(nudge), "Keep your %d-day streak!", streak);
  st_text(ctx, nag ? nudge : summary, nag ? FONT_KEY_GOTHIC_14_BOLD : FONT_KEY_GOTHIC_14,
          GRect(8, 22, cw - 10, 18), GTextAlignmentLeft, nag ? C_ACC : C_MUTE);

  int y = 44;
  for (int i = 0; i < n; i++, y += HOME_ROW_H) {
    const GColor kc = kind_color(kind_from_ref(rows[i].ref));
    const bool fresh = s_just.on && strcmp(rows[i].ref, s_just.ref) == 0;
    if (fresh) {
      graphics_context_set_fill_color(ctx, C_FG);
      graphics_fill_rect(ctx, GRect(0, y, cw, HOME_ROW_H), 0, GCornerNone);
    } else {
      graphics_context_set_fill_color(ctx, kc);
      graphics_fill_rect(ctx, GRect(0, y + 7, 4, HOME_ROW_H - 14), 2, GCornersRight);
      graphics_context_set_stroke_color(ctx, C_LINE);
      graphics_draw_line(ctx, GPoint(8, y + HOME_ROW_H - 1), GPoint(cw - 6, y + HOME_ROW_H - 1));
    }
    st_text(ctx, rows[i].title, FONT_KEY_GOTHIC_18_BOLD, GRect(10, y + 1, cw - 14, 22), GTextAlignmentLeft,
            fresh ? C_BG : C_FG);
    draw_stars(ctx, &s_mini, 10 + s_mini.hw, y + 30, 2 * s_mini.hw + 4, rows[i].half,
               fresh ? C_BG : C_LINE, fresh ? C_FG : C_BG);
    if (fresh) {
      st_text(ctx, "SAVED", FONT_KEY_GOTHIC_14_BOLD, GRect(cw - 60, y + 20, 54, 18), GTextAlignmentRight, C_BG);
    }
  }
  if (n == 0) {
    graphics_context_set_fill_color(ctx, C_ACC);
    graphics_fill_circle(ctx, GPoint(cw / 2, 78), 24);
    draw_icon(ctx, 2, GRect(cw / 2 - 18, 60, 36, 36), C_BG);
    st_text(ctx, "Press the middle button and say it", FONT_KEY_GOTHIC_18,
            GRect(12, 108, cw - 24, 46), GTextAlignmentCenter, C_MUTE);
    y = 164;
  }

  // up next: the next unrated episode of the shows you follow, as far as there is room
  if (s_cont_count > 0 && y + 20 + NEXT_ROW_H <= b.size.h) {
    st_text(ctx, "UP NEXT", FONT_KEY_GOTHIC_14_BOLD, GRect(8, y - 1, cw - 10, 18), GTextAlignmentLeft, C_ACC);
    graphics_context_set_stroke_color(ctx, C_ACC);
    graphics_draw_line(ctx, GPoint(8, y + 18), GPoint(cw - 6, y + 18));
    y += 20;
    for (int i = 0; i < s_cont_count && y + NEXT_ROW_H <= b.size.h; i++, y += NEXT_ROW_H) {
      graphics_context_set_fill_color(ctx, kind_color(kind_from_ref(s_cont[i].ref)));
      graphics_fill_rect(ctx, GRect(0, y + 7, 4, NEXT_ROW_H - 14), 2, GCornersRight);
      st_text(ctx, s_cont[i].label, FONT_KEY_GOTHIC_18_BOLD, GRect(10, y + (NEXT_ROW_H - 22) / 2 - 2, cw - 14, 22),
              GTextAlignmentLeft, C_FG);
    }
  }

}

static void home_select(ClickRecognizerRef rec, void *ctx) {
  s_search_kind = KIND_ALL;
  s_dict_mode = 0;
  dictation_session_start(s_dict);
}

// Hold the middle button to re-rate the newest item on the list (fix a mis-tap).
static void home_rerate(ClickRecognizerRef rec, void *ctx) {
  HomeRow rows[1];
  if (home_collect(rows, 1) < 1) return;
  rate_push_at(rows[0].ref, rows[0].title, false, rows[0].half);
}

static void home_click_config(void *ctx) {
  window_single_click_subscribe(BUTTON_ID_SELECT, home_select);
  window_long_click_subscribe(BUTTON_ID_SELECT, 600, home_rerate, NULL);
}

static void home_appear(Window *window) {
  s_home_token = s_next_token++;
  send_request(REQ_HOME, 0, NULL, s_home_token);
  s_cont_token = s_next_token++;
  send_request(REQ_CONTINUE, 0, NULL, s_cont_token);
}

static void home_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_home_layer = layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_home_layer, home_update);
  layer_add_child(root, s_home_layer);
}

static void home_unload(Window *window) {
  layer_destroy(s_home_layer);
  s_home_layer = NULL;
}

// ---------------------------------------------------------------------------
// Hub: eight tiles. Up and Down move the focus (it wraps), Select opens the tile.
// Hold Up / Down jump to the first / last tile, hold Select listens from any tile.
// ---------------------------------------------------------------------------

#define HUB_TILES 8
#define TILE_W 88
#define TILE_H 44

static int s_hub_focus;

static const char *const HUB_LABEL[HUB_TILES] = { "Say it", "People", "Today", "Reflect", "Stats", "Log a...", "Shelf", "Note" };
static const char *const HUB_SUB[HUB_TILES] = { "any kind", "who you met", "", "add notes", "", "pick a kind", "recent, marks", "to anything" };

static GColor hub_color(int i) {
  switch (i) {
    case 0: return GColorDukeBlue;
    case 1: return kind_color(KIND_PEOPLE);
    case 2: return GColorDarkGray;
    case 3: return GColorBlack;
    case 4: return GColorCobaltBlue;
    case 5: return GColorDarkCandyAppleRed;
    case 7: return GColorImperialPurple;
    default: return GColorArmyGreen;
  }
}

static void hub_update(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  graphics_context_set_fill_color(ctx, C_BG);
  graphics_fill_rect(ctx, b, 0, GCornerNone);

  time_t now = time(NULL);
  struct tm *t = localtime(&now);
  char head[32];
  snprintf(head, sizeof(head), "LOGBOOK, %s %s %d", DAY_NAMES[t->tm_wday % 7], MONTH_NAMES[t->tm_mon % 12], t->tm_mday);
  // a message from the phone or a "Logged Maria" confirmation replaces the date for a moment
  st_text(ctx, s_flash[0] ? s_flash : head, FONT_KEY_GOTHIC_14_BOLD, GRect(8, -1, b.size.w - 16, 18),
          GTextAlignmentLeft, s_flash[0] ? C_OK : C_ACC);
  graphics_context_set_stroke_color(ctx, C_ACC);
  graphics_draw_line(ctx, GPoint(8, 20), GPoint(b.size.w - 8, 20));

  HomeRow rows[MAX_HOME];
  const int rated = home_collect(rows, MAX_HOME);
  int streak = 0, met = 0;
  for (int i = 0; i < s_home_count; i++) {
    if ((s_home[i].flags & 15) == 4) streak = atoi(s_home[i].label);
    if ((s_home[i].flags & 15) == 8) met = atoi(s_home[i].label);
  }
  char today_sub[16], stats_sub[20], people_sub[20];
  snprintf(today_sub, sizeof(today_sub), "%d rated", rated);
  if (streak > 0) snprintf(stats_sub, sizeof(stats_sub), "%d day streak", streak);
  else copy_str(stats_sub, sizeof(stats_sub), "charts");
  if (met > 0) snprintf(people_sub, sizeof(people_sub), "%d met today", met);
  else copy_str(people_sub, sizeof(people_sub), "who you met");

  for (int i = 0; i < HUB_TILES; i++) {
    const int x = (i % 2) ? 104 : 8;
    const int y = 25 + (i / 2) * 50;
    const GColor c = hub_color(i);
    const GColor fg = on_color(c);
    if (i == s_hub_focus) {   // focus ring: a larger round rect behind the tile
      graphics_context_set_fill_color(ctx, gcolor_equal(c, GColorBlack) ? C_ACC : C_FG);
      graphics_fill_rect(ctx, GRect(x - 3, y - 3, TILE_W + 6, TILE_H + 6), 11, GCornersAll);
    }
    graphics_context_set_fill_color(ctx, c);
    graphics_fill_rect(ctx, GRect(x, y, TILE_W, TILE_H), 8, GCornersAll);
    graphics_context_set_text_color(ctx, fg);
    graphics_draw_text(ctx, HUB_LABEL[i], fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(x + 8, y + 1, TILE_W - 16, 22), GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    const char *sub = i == 1 ? people_sub : (i == 2 ? today_sub : (i == 4 ? stats_sub : HUB_SUB[i]));
    graphics_draw_text(ctx, sub, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                       GRect(x + 8, y + 23, TILE_W - 12, 18), GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    const GRect ib = GRect(x + TILE_W - 30, y + 1, 26, 26);
    switch (i) {
      case 0: draw_icon(ctx, 2, ib, fg); break;
      case 1: draw_icon(ctx, KIND_PEOPLE, ib, fg); break;
      case 2: draw_icon(ctx, KIND_RECENT, ib, fg); break;
      case 3: draw_icon(ctx, 10, ib, fg); break;
      case 4:
        graphics_context_set_fill_color(ctx, fg);
        graphics_fill_rect(ctx, GRect(ib.origin.x + 4, ib.origin.y + 12, 5, 8), 1, GCornersTop);
        graphics_fill_rect(ctx, GRect(ib.origin.x + 11, ib.origin.y + 5, 5, 15), 1, GCornersTop);
        graphics_fill_rect(ctx, GRect(ib.origin.x + 18, ib.origin.y + 9, 5, 11), 1, GCornersTop);
        break;
      case 5: draw_icon(ctx, 8, ib, fg); break;
      case 7: draw_icon(ctx, 2, ib, fg); break;
      default: draw_icon(ctx, 11, ib, fg); break;
    }
  }
}

static void hub_move(int d) {
  s_hub_focus = (s_hub_focus + d + HUB_TILES) % HUB_TILES;
  layer_mark_dirty(s_hub_layer);
}

static void hub_up(ClickRecognizerRef rec, void *ctx) { hub_move(-1); }
static void hub_down(ClickRecognizerRef rec, void *ctx) { hub_move(1); }

static void hub_first(ClickRecognizerRef rec, void *ctx) {
  s_hub_focus = 0;
  layer_mark_dirty(s_hub_layer);
}

static void hub_last(ClickRecognizerRef rec, void *ctx) {
  s_hub_focus = HUB_TILES - 1;
  layer_mark_dirty(s_hub_layer);
}

static void hub_say(ClickRecognizerRef rec, void *ctx) {
  home_select(NULL, NULL);   // listen, search every kind
}

static void shelf_push(void);
static void note_push(void);

static void hub_select(ClickRecognizerRef rec, void *ctx) {
  switch (s_hub_focus) {
    case 0: hub_say(NULL, NULL); break;
    case 1: people_push(); break;
    case 2: window_stack_push(s_home_window, true); break;
    case 3: reflect_push(); break;
    case 4: stats_push(); break;
    case 5: window_stack_push(s_main_window, true); break;
    case 7: note_push(); break;
    default: shelf_push(); break;
  }
}

static void hub_click_config(void *ctx) {
  window_single_click_subscribe(BUTTON_ID_UP, hub_up);
  window_single_click_subscribe(BUTTON_ID_DOWN, hub_down);
  window_single_click_subscribe(BUTTON_ID_SELECT, hub_select);
  window_long_click_subscribe(BUTTON_ID_UP, 500, hub_first, NULL);
  window_long_click_subscribe(BUTTON_ID_DOWN, 500, hub_last, NULL);
  window_long_click_subscribe(BUTTON_ID_SELECT, 500, hub_say, NULL);
}

static void hub_touch_on(Window *window);

static void hub_appear(Window *window) {
#ifdef PBL_TOUCH
  hub_touch_on(window);
#endif
  s_home_token = s_next_token++;   // refresh the counts on the tiles
  send_request(REQ_HOME, 0, NULL, s_home_token);
  if (s_auto_listen) {   // launched from the quick-launch button: straight to listening
    s_auto_listen = false;
    hub_say(NULL, NULL);
  }
}

#ifdef PBL_TOUCH
static void hub_select(ClickRecognizerRef rec, void *ctx);

// Touch: tap a tile to open it.
static void hub_touch(const TouchEvent *ev, void *ctx) {
  if (ev->type != TouchEvent_Liftoff || ev->non_navigational) return;
  for (int i = 0; i < HUB_TILES; i++) {
    const int x = (i % 2) ? 104 : 8;
    const int y = 25 + (i / 2) * 50;
    if (ev->x >= x - 3 && ev->x < x + TILE_W + 3 && ev->y >= y - 3 && ev->y < y + TILE_H + 3) {
      s_hub_focus = i;
      layer_mark_dirty(s_hub_layer);
      hub_select(NULL, NULL);
      return;
    }
  }
}

static void hub_touch_on(Window *window) { if (touch_service_is_enabled()) touch_service_subscribe(hub_touch, NULL); }
static void hub_touch_off(Window *window) { touch_service_unsubscribe(); }
#endif

static void hub_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_hub_layer = layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_hub_layer, hub_update);
  layer_add_child(root, s_hub_layer);
}

static void hub_unload(Window *window) {
  layer_destroy(s_hub_layer);
  s_hub_layer = NULL;
}

// Shelf: Recent, Bookmarks, Favorites.
static Window *s_shelf_window;
static MenuLayer *s_shelf_menu;

static uint16_t shelf_rows(MenuLayer *ml, uint16_t section, void *data) { return 3; }
static int16_t shelf_header_height(MenuLayer *ml, uint16_t section, void *data) { return 20; }
static int16_t shelf_cell_height(MenuLayer *ml, MenuIndex *idx, void *data) { return ROW_H; }

static void shelf_draw_header(GContext *ctx, const Layer *cell, uint16_t section, void *data) {
  draw_fancy_header(ctx, cell, "SHELF", C_ACC);
}

static void shelf_draw_row(GContext *ctx, const Layer *cell, MenuIndex *idx, void *data) {
  static const char *const T[3] = { "Recent", "Bookmarks", "Favorites" };
  static const char *const S[3] = { "Your latest ratings", "Where you left off", "Pinned shows, albums" };
  static const int ICON[3] = { KIND_RECENT, 11, 12 };
  draw_icon_row_c(ctx, cell, ICON[idx->row], GColorArmyGreen, T[idx->row], S[idx->row]);
}

static void shelf_select(MenuLayer *ml, MenuIndex *idx, void *data) {
  ListWin *w;
  if (idx->row == 0) {
    w = list_push("Recent", false, KIND_RECENT);
    if (w) { w->token = s_next_token++; send_request(REQ_RECENT, 0, NULL, w->token); }
  } else if (idx->row == 1) {
    w = list_push("Bookmarks", false, 4);
    if (w) { w->token = s_next_token++; send_request(REQ_MARKS, 0, NULL, w->token); }
  } else {
    w = list_push("Favorites", false, 4);
    if (w) { w->token = s_next_token++; send_request(REQ_FAVS, 0, NULL, w->token); }
  }
}

static void shelf_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_shelf_menu = menu_layer_create(layer_get_bounds(root));
  menu_layer_set_callbacks(s_shelf_menu, NULL, (MenuLayerCallbacks){
    .get_num_rows = shelf_rows,
    .get_header_height = shelf_header_height,
    .get_cell_height = shelf_cell_height,
    .draw_header = shelf_draw_header,
    .draw_row = shelf_draw_row,
    .select_click = shelf_select,
  });
  menu_layer_set_normal_colors(s_shelf_menu, C_BG, C_FG);
  menu_layer_set_highlight_colors(s_shelf_menu, C_FG, C_BG);
  menu_layer_set_center_focused(s_shelf_menu, false);
  menu_layer_set_click_config_onto_window(s_shelf_menu, window);
  layer_add_child(root, menu_layer_get_layer(s_shelf_menu));
}

static void shelf_unload(Window *window) {
  menu_layer_destroy(s_shelf_menu);
  s_shelf_menu = NULL;
}

static void shelf_push(void) {
  window_stack_push(s_shelf_window, true);
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

// Keep listening: the watch ends dictation at the first pause, which can cut a thought
// short. For notes, each accepted phrase is added to a running note and the microphone
// opens again. Press Back (or stay quiet) to finish and save the whole note.
static char s_keep[NOTE_LEN];
static int s_keep_mode;       // note mode being built up, 0 when idle
static AppTimer *s_keep_timer;
static void keep_finish(void);

static void keep_restart_cb(void *ctx) {
  s_keep_timer = NULL;
  if (!s_keep_mode) return;
  s_dict_mode = s_keep_mode;
  dictation_session_enable_error_dialogs(s_dict, false);   // silence just means "done"
  if (dictation_session_start(s_dict) != DictationSessionStatusSuccess) {
    s_dict_mode = 0;
    keep_finish();
  }
}

static void keep_finish(void) {
  const int mode = s_keep_mode;
  s_keep_mode = 0;
  dictation_session_enable_error_dialogs(s_dict, true);
  if (!s_keep[0]) return;
  if (mode == 5) {   // a note only: about a person (no meeting counted), an item, or a loose thought
    char msg[32];
    queue_log(s_note_ref, s_note_title, 0, s_note_ref[0] == 'n' ? "note" : "", s_keep);
    snprintf(msg, sizeof(msg), "Noted: %s", s_note_title[0] ? s_note_title : "thought");
    flash_show(msg);
    people_pop();
  } else if (mode == 4) {
    vibes_short_pulse();
    queue_log(s_note_ref, s_note_title, 0, "", s_keep);
    people_done(s_note_title);
  } else {
    vibes_short_pulse();
    queue_log(s_note_ref, s_note_title, 0, "", s_keep);
  }
  s_keep[0] = '\0';
}

static void keep_add(const char *text) {
  size_t have = strlen(s_keep);
  if (have > 0 && have + 2 < sizeof(s_keep)) { s_keep[have++] = ' '; s_keep[have] = '\0'; }
  strncat(s_keep, text, sizeof(s_keep) - strlen(s_keep) - 1);
}

static void dictation_cb(DictationSession *session, DictationSessionStatus status,
                         char *text, void *ctx) {
  const int mode = s_dict_mode;
  s_dict_mode = 0;

  // Building up a note (people notes and notes on an item)
  if (mode == 2 || mode == 4 || mode == 5 || s_keep_mode) {
    const int m = s_keep_mode ? s_keep_mode : mode;
    if (!s_keep_mode) { s_keep_mode = m; s_keep[0] = '\0'; }
    if (status == DictationSessionStatusSuccess && text && text[0]) {
      keep_add(text);
      if (strlen(s_keep) < sizeof(s_keep) - 20) {   // room for more: listen again
        s_keep_timer = app_timer_register(250, keep_restart_cb, NULL);
        return;
      }
    }
    keep_finish();
    return;
  }

  // The system already shows its own error dialogs, so only act on success.
  if (status != DictationSessionStatusSuccess || !text || !text[0]) return;
  if (mode == 3) {   // someone new: "Maria", "coffee with Maria", "Maria, talked about the trip"
    queue_log("n:?", "", 0, "", text);   // the phone works out the name and matches known people
    people_pop();
    return;
  }
  if (mode == 1) {   // a category for an Anything item
    char tag[TAG_LEN];
    copy_str(tag, sizeof(tag), text);
    for (char *c = tag; *c; c++) if (*c >= 'A' && *c <= 'Z') *c += 32;
    size_t n = strlen(tag);
    while (n > 0 && (tag[n - 1] == '.' || tag[n - 1] == ' ' || tag[n - 1] == '!' || tag[n - 1] == '?')) tag[--n] = '\0';
    tag_finish(tag);
    return;
  }
  ListWin *w = list_push(text, true, s_search_kind);
  if (w) {
    w->token = s_next_token++;
    send_request(REQ_SEARCH, s_search_kind, text, w->token);
  }
}

// ---------------------------------------------------------------------------
// Messages from the phone: lists of entries
// ---------------------------------------------------------------------------

static void fill_entry(Entry *en, DictionaryIterator *it) {
  Tuple *t;
  memset(en, 0, sizeof(*en));
  if ((t = dict_find(it, MESSAGE_KEY_LIST_LABEL))) copy_str(en->label, sizeof(en->label), t->value->cstring);
  if ((t = dict_find(it, MESSAGE_KEY_LIST_REF))) copy_str(en->ref, sizeof(en->ref), t->value->cstring);
  if ((t = dict_find(it, MESSAGE_KEY_LIST_FLAGS))) en->flags = (uint8_t)t->value->int32;
}

static void inbox_received(DictionaryIterator *it, void *ctx) {
  Tuple *t_tok = dict_find(it, MESSAGE_KEY_LIST_TOKEN);
  if (!t_tok) return;
  int token = (int)t_tok->value->int32;
  Tuple *t_err = dict_find(it, MESSAGE_KEY_LIST_ERROR);
  Tuple *t_total = dict_find(it, MESSAGE_KEY_LIST_TOTAL);
  Tuple *t_idx = dict_find(it, MESSAGE_KEY_LIST_INDEX);
  int total = t_total ? (int)t_total->value->int32 : 0;
  int idx = t_idx ? (int)t_idx->value->int32 : 0;

  // A short message from the phone (token 0): "Saved @26:00", "Pinned to favorites"
  if (token == 0) {
    Tuple *t_lab = dict_find(it, MESSAGE_KEY_LIST_LABEL);
    if (t_lab) flash_show(t_lab->value->cstring);
    reflect_refresh();
    return;
  }

  // Favorites at the top of the full menu
  if (token == s_fav_token && s_fav_token != 0) {
    if (t_err || total <= 0) {
      s_fav_count = 0;
    } else if (idx >= 0 && idx < MAX_FAVS) {
      if (idx == 0) s_fav_count = 0;
      fill_entry(&s_favs[idx], it);
      if (idx + 1 > s_fav_count) s_fav_count = idx + 1;
    }
    if (s_main_menu) menu_layer_reload_data(s_main_menu);
    return;
  }

  // Home: the summary line and today's ratings
  if (token == s_home_token) {
    if (t_err || total <= 0) {
      s_home_count = 0;
    } else if (idx >= 0 && idx < MAX_HOME) {
      if (idx == 0) s_home_count = 0;
      fill_entry(&s_home[idx], it);
      if (idx + 1 > s_home_count) s_home_count = idx + 1;
    }
    if (s_home_layer) layer_mark_dirty(s_home_layer);
    if (s_hub_layer) layer_mark_dirty(s_hub_layer);
    return;
  }

  // Categories you used before (for the Anything category screen)
  if (token == s_tag_token && s_tag_token != 0) {
    if (!t_err && total > 0 && idx >= 0 && idx < MAX_TAGS) {
      if (idx == 0) s_tag_count = 0;
      fill_entry(&s_tags[idx], it);
      if (idx + 1 > s_tag_count) s_tag_count = idx + 1;
    }
    if (s_tag_menu) menu_layer_reload_data(s_tag_menu);
    return;
  }

  // Stats pages
  if (token == s_stats_token && s_stats_token != 0) {
    if (s_stats_timeout) {
      app_timer_cancel(s_stats_timeout);
      s_stats_timeout = NULL;
    }
    if (t_err) {
      copy_str(s_stats_status, sizeof(s_stats_status), t_err->value->cstring);
    } else if (total <= 0) {
      memset(&s_st, 0, sizeof(s_st));
      s_st.ready = true;
    } else if (idx >= 0 && idx < MAX_ENTRIES) {
      Entry en;
      fill_entry(&en, it);
      stats_ingest(idx, &en);
      if (idx == total - 1) { s_st.ready = true; anim_start(); }
    }
    if (s_stats_layer) layer_mark_dirty(s_stats_layer);
    return;
  }

  // The "Continue" list (Up next on Home, and the top of the full menu)
  if (token == s_cont_token) {
    if (total <= 0 || t_err) {
      s_cont_count = 0;
    } else if (idx >= 0 && idx < MAX_CONT) {
      if (idx == 0) s_cont_count = 0;
      fill_entry(&s_cont[idx], it);
      if (idx + 1 > s_cont_count) s_cont_count = idx + 1;
    }
    if (s_main_menu) menu_layer_reload_data(s_main_menu);
    if (s_home_layer) layer_mark_dirty(s_home_layer);
    return;
  }

  ListWin *w = find_list(token);
  if (!w) return;
  if (w->timeout) {
    app_timer_cancel(w->timeout);
    w->timeout = NULL;
  }

  if (t_err) {
    copy_str(w->status, sizeof(w->status), t_err->value->cstring);
    w->ready = false;
    w->refresh = false;
    list_reload(w);
    return;
  }
  if (total <= 0) {
    w->count = 0;
    w->ready = true;
    w->refresh = false;
    list_reload(w);
    return;
  }
  if (idx < 0 || idx >= MAX_ENTRIES) return;
  if (w->refresh) {
    // asking again for a page that is already showing: overwrite the rows in place and
    // swap in the new count at the end, so the highlighted row never jumps
    fill_entry(&w->e[idx], it);
    if (idx == total - 1 || idx == MAX_ENTRIES - 1) {
      w->count = idx + 1;
      w->refresh = false;
    }
    list_reload(w);
    return;
  }
  if (idx == 0) w->count = 0;
  fill_entry(&w->e[idx], it);
  if (idx + 1 > w->count) w->count = idx + 1;
  if (idx == total - 1 || idx == MAX_ENTRIES - 1) w->ready = true;
  list_reload(w);
}

static void tick_handler(struct tm *t, TimeUnits units) {
  if (s_req_n > 0 || s_pend_n > 0) pump_outbox();
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

static void init(void) {
#ifdef PBL_TOUCH
  app_touch_navigation_enable(true);   // tap rows and swipe in every list
#endif
  load_pending();
  star_shape_init(&s_mini, 4);

  app_message_register_inbox_received(inbox_received);
  app_message_register_outbox_sent(outbox_sent);
  app_message_register_outbox_failed(outbox_failed);
  app_message_open(512, 768);

  s_dict = dictation_session_create(SEG_LEN, dictation_cb, NULL);

  s_rate_window = window_create();
  window_set_background_color(s_rate_window, C_BG);
  window_set_click_config_provider(s_rate_window, rate_click_config);
  window_set_window_handlers(s_rate_window, (WindowHandlers){
    .load = rate_window_load,
    .unload = rate_window_unload,
#ifdef PBL_TOUCH
    .appear = rate_appear,
    .disappear = rate_disappear,
#endif
  });

  s_tag_window = window_create();
  window_set_background_color(s_tag_window, C_BG);
  window_set_window_handlers(s_tag_window, (WindowHandlers){
    .load = tag_load,
    .unload = tag_unload,
  });

  s_stats_window = window_create();
  window_set_background_color(s_stats_window, C_BG);
  window_set_click_config_provider(s_stats_window, stats_click_config);
  window_set_window_handlers(s_stats_window, (WindowHandlers){
    .load = stats_load,
    .unload = stats_unload,
  });

  s_main_window = window_create();
  window_set_background_color(s_main_window, C_BG);
  window_set_window_handlers(s_main_window, (WindowHandlers){
    .load = main_load,
    .unload = main_unload,
  });

  s_pact_window = window_create();
  window_set_background_color(s_pact_window, C_BG);
  window_set_window_handlers(s_pact_window, (WindowHandlers){
    .load = pact_load,
    .unload = pact_unload,
  });

  s_shelf_window = window_create();
  window_set_background_color(s_shelf_window, C_BG);
  window_set_window_handlers(s_shelf_window, (WindowHandlers){
    .load = shelf_load,
    .unload = shelf_unload,
  });

  s_hub_window = window_create();
  window_set_background_color(s_hub_window, C_BG);
  window_set_click_config_provider(s_hub_window, hub_click_config);
  window_set_window_handlers(s_hub_window, (WindowHandlers){
    .load = hub_load,
    .unload = hub_unload,
    .appear = hub_appear,
#ifdef PBL_TOUCH
    .disappear = hub_touch_off,
#endif
  });

  s_home_window = window_create();
  window_set_background_color(s_home_window, C_BG);
  window_set_click_config_provider(s_home_window, home_click_config);
  window_set_window_handlers(s_home_window, (WindowHandlers){
    .load = home_load,
    .unload = home_unload,
    .appear = home_appear,
  });
  s_auto_listen = (launch_reason() == APP_LAUNCH_QUICK_LAUNCH);
  window_stack_push(s_hub_window, true);

  tick_timer_service_subscribe(SECOND_UNIT, tick_handler);
}

static void deinit(void) {
  tick_timer_service_unsubscribe();
  if (s_keep_timer) app_timer_cancel(s_keep_timer);
  if (s_dict) dictation_session_destroy(s_dict);
  if (s_just_timer) app_timer_cancel(s_just_timer);
  window_destroy(s_rate_window);
  window_destroy(s_stats_window);
  window_destroy(s_tag_window);
  window_destroy(s_main_window);
  window_destroy(s_home_window);
  window_destroy(s_hub_window);
  window_destroy(s_shelf_window);
  window_destroy(s_pact_window);
  star_shape_free(&s_mini);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
