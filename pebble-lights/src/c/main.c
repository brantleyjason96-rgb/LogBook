// Home Lights 3. The phone builds every list (src/pkjs/index.js); this app draws rows and reports button presses.
//
//   Everywhere:     TAP SELECT = do it   HOLD UP = fine-tune   HOLD SELECT = talk
//   List screens:   UP / DOWN move (they wrap around). A tap toggles a light or a whole room, runs a scene, turns
//                   everything off, opens the thermostat or opens "All rooms". Hold UP on a light opens its brightness,
//                   on a room opens that room's lights.
//   Brightness:     UP / DOWN change it, SELECT applies, BACK applies and leaves
//   Thermostat:     UP / DOWN change the set point, SELECT cycles Heat / Cool / Eco / Off
//   Voice result:   UP = undo, DOWN = try again, SELECT = done
#include <pebble.h>

#define MAX_LISTS 3
#define MAX_ROWS 26
#define MAX_CHOICES 4
#define TITLE_LEN 24
#define SUB_LEN 16
#define TEXT_LEN 64
#define SAY_LEN 120

#define KIND_LIST 10
#define KIND_ROW 11
#define KIND_BRIGHT 12
#define KIND_THERMO 13
#define KIND_OPEN 14
#define KIND_RESULT 4
#define KIND_STATUS 5
#define KIND_CHOICE 6

#define CMD_TAP 1
#define CMD_HOLD 2
#define CMD_BRIGHT 3
#define CMD_TEMP 4
#define CMD_MODE 5
#define CMD_CLOSED 6
#define CMD_VOICE 7
#define CMD_UNDO 8
#define CMD_CHOOSE 9
#define CMD_REFRESH 10

#define TYPE_LIGHT 0
#define TYPE_ROOM 1
#define TYPE_SCENE 2
#define TYPE_THERMO 3
#define TYPE_MORE 4
#define TYPE_ALL_OFF 5

#define ROW_H 34
#define SEND_DELAY_MS 650
#define TEMP_MIN 50
#define TEMP_MAX 90
#define VOICE_CLOSE_MS 12000
#define LONG_MS 500

typedef struct {
  char title[TITLE_LEN];
  char sub[SUB_LEN];
  int8_t state;  // 0 off, 1 on, 2 offline, 3 not a light
  int8_t type;
  int8_t adj;  // 1 if holding UP does something
} Row;

typedef struct {
  Window *window;
  StatusBarLayer *status_bar;
  MenuLayer *menu;
  TextLayer *message;
  int list_id;
  int count;
  int room;  // the room this list is about, or -1
  bool in_use;
  char title[TITLE_LEN];
  Row rows[MAX_ROWS];
} ListWin;

static ListWin s_lw[MAX_LISTS];
static char s_status[TEXT_LEN] = "Loading lights...";
static const char *MODE_NAMES[] = {"Heat", "Cool", "Eco", "Off"};

// ---- brightness screen
static Window *s_bright_window;
static StatusBarLayer *s_bright_status;
static Layer *s_bright_layer;
static int s_bright_idx = -1, s_bright_value = 0, s_bright_step = 10, s_bright_room = -1;
static char s_bright_name[TITLE_LEN];
static AppTimer *s_bright_timer;

// ---- thermostat screen
static Window *s_th_window;
static StatusBarLayer *s_th_status;
static Layer *s_th_layer;
static int s_th_idx = -1, s_th_set = 70, s_th_temp = -1, s_th_mode = 0, s_th_step = 1, s_th_room = -1;
static char s_th_name[TITLE_LEN];
static AppTimer *s_th_timer;

// ---- voice result card
static Window *s_voice_window;
static Layer *s_voice_layer;
static int s_v_state = 0;  // 0 working, 1 done, 2 problem
static bool s_v_undo = false;
static char s_v_title[TEXT_LEN], s_v_sub[TEXT_LEN];
static AppTimer *s_v_timer;

// ---- "which one?" list
static Window *s_choice_window;
static MenuLayer *s_choice_menu;
static char s_choice_prompt[TEXT_LEN] = "Which one?";
static char s_choice_name[MAX_CHOICES][TITLE_LEN + 17], s_choice_sub[MAX_CHOICES][TITLE_LEN + 17];
static int s_choice_count = 0;

#ifdef PBL_MICROPHONE
static DictationSession *s_dict;
static char s_transcript[SAY_LEN];
#endif

// ---------------------------------------------------------------- helpers

static int clampi(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }

static void copy_str(char *dst, size_t n, const char *src) {
  strncpy(dst, src ? src : "", n - 1);
  dst[n - 1] = '\0';
}
static int get_int(DictionaryIterator *it, uint32_t key, int def) {
  Tuple *t = dict_find(it, key);
  return t ? (int)t->value->int32 : def;
}
static const char *get_str(DictionaryIterator *it, uint32_t key) {
  Tuple *t = dict_find(it, key);
  return t ? t->value->cstring : "";
}

static void send_cmd(int cmd, int a, int b) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    vibes_short_pulse();  // phone link busy or down: the press didn't go through
    return;
  }
  dict_write_int32(iter, MESSAGE_KEY_cmd, cmd);
  if (a >= 0) dict_write_int32(iter, MESSAGE_KEY_list, a);
  if (b >= 0) dict_write_int32(iter, MESSAGE_KEY_idx, b);
  app_message_outbox_send();
}
// Commands that carry an index and a value rather than a list and a row.
static void send_val(int cmd, int idx, int value) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    vibes_short_pulse();
    return;
  }
  dict_write_int32(iter, MESSAGE_KEY_cmd, cmd);
  dict_write_int32(iter, MESSAGE_KEY_idx, idx);
  dict_write_int32(iter, MESSAGE_KEY_value, value);
  app_message_outbox_send();
}
static void send_say(const char *text, int room) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    vibes_short_pulse();
    return;
  }
  dict_write_int32(iter, MESSAGE_KEY_cmd, CMD_VOICE);
  dict_write_cstring(iter, MESSAGE_KEY_say, text);
  if (room >= 0) dict_write_int32(iter, MESSAGE_KEY_value, room);
  app_message_outbox_send();
}
static void outbox_failed(DictionaryIterator *iter, AppMessageResult reason, void *ctx) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "send failed: %d", (int)reason);
  vibes_short_pulse();
}

static ListWin *lw_find(int id) {
  for (int i = 0; i < MAX_LISTS; i++) {
    if (s_lw[i].in_use && s_lw[i].list_id == id) return &s_lw[i];
  }
  return NULL;
}
static ListWin *lw_of_window(Window *w) {
  for (int i = 0; i < MAX_LISTS; i++) {
    if (s_lw[i].window == w) return &s_lw[i];
  }
  return NULL;
}

// The room the visible screen is about, so "turn them off" means that room.
static int ctx_room(void) {
  Window *top = window_stack_get_top_window();
  if (top == s_bright_window) return s_bright_room;
  if (top == s_th_window) return s_th_room;
  ListWin *lw = lw_of_window(top);
  return lw ? lw->room : -1;
}

// ---------------------------------------------------------------- voice result window

static void voice_close(void *data) {
  s_v_timer = NULL;
  if (window_stack_get_top_window() == s_voice_window) window_stack_pop(true);
}
static void voice_arm_timer(void) {
  if (s_v_timer) {
    app_timer_cancel(s_v_timer);
    s_v_timer = NULL;
  }
  if (s_v_state != 0) s_v_timer = app_timer_register(VOICE_CLOSE_MS, voice_close, NULL);
}
static void voice_show(int state, bool undo, const char *title, const char *sub) {
  s_v_state = state;
  s_v_undo = undo;
  copy_str(s_v_title, sizeof(s_v_title), title);
  copy_str(s_v_sub, sizeof(s_v_sub), sub);
  if (window_stack_get_top_window() != s_voice_window) {
    if (s_choice_window && window_stack_get_top_window() == s_choice_window) window_stack_pop(false);  // stale now
    window_stack_push(s_voice_window, true);
  }
  if (s_voice_layer) layer_mark_dirty(s_voice_layer);
  voice_arm_timer();
}

static void voice_draw(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  bool big = b.size.h >= 190;
  int m = PBL_IF_ROUND_ELSE(24, 8);
  int cx = b.size.w / 2, cy = big ? 40 : 30, r = big ? 22 : 16;

  GColor ring = s_v_state == 1 ? PBL_IF_COLOR_ELSE(GColorIslamicGreen, GColorWhite)
              : (s_v_state == 2 ? PBL_IF_COLOR_ELSE(GColorSunsetOrange, GColorWhite) : PBL_IF_COLOR_ELSE(GColorOrange, GColorWhite));
  graphics_context_set_fill_color(ctx, ring);
  graphics_fill_circle(ctx, GPoint(cx, cy), r);
  graphics_context_set_stroke_color(ctx, PBL_IF_COLOR_ELSE(GColorWhite, GColorBlack));
  graphics_context_set_stroke_width(ctx, 4);
  if (s_v_state == 1) {
    graphics_draw_line(ctx, GPoint(cx - r / 2, cy), GPoint(cx - r / 6, cy + r / 2));
    graphics_draw_line(ctx, GPoint(cx - r / 6, cy + r / 2), GPoint(cx + r / 2, cy - r / 2));
  } else if (s_v_state == 2) {
    graphics_draw_line(ctx, GPoint(cx, cy - r / 2), GPoint(cx, cy + 1));
    graphics_draw_line(ctx, GPoint(cx, cy + r / 2 - 1), GPoint(cx, cy + r / 2));
  } else {
    graphics_draw_line(ctx, GPoint(cx - r / 2, cy), GPoint(cx + r / 2, cy));
  }

  int ty = cy + r + 6, th = big ? 62 : 42;
  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(ctx, s_v_title, fonts_get_system_font(big ? FONT_KEY_GOTHIC_24_BOLD : FONT_KEY_GOTHIC_18_BOLD),
                     GRect(m, ty, b.size.w - 2 * m, th), GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  graphics_context_set_text_color(ctx, PBL_IF_COLOR_ELSE(GColorLightGray, GColorWhite));
  graphics_draw_text(ctx, s_v_sub, fonts_get_system_font(FONT_KEY_GOTHIC_14), GRect(m, ty + th, b.size.w - 2 * m, 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

  if (s_v_state == 0) return;
  int ph = big ? 28 : 24, py = b.size.h - ph - (big ? 10 : 6);
  int pw = (b.size.w - 2 * m - 8) / 2;
  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_context_set_stroke_color(ctx, GColorWhite);
  graphics_context_set_stroke_width(ctx, 1);
  if (s_v_state == 1 && s_v_undo) {
    graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(GColorDarkGray, GColorBlack));
    graphics_fill_rect(ctx, GRect(m, py, pw, ph), ph / 2, GCornersAll);
    graphics_draw_round_rect(ctx, GRect(m, py, pw, ph), ph / 2);
    graphics_draw_text(ctx, "Undo", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(m, py + (ph - 22) / 2 - 2, pw, 22),
                       GTextOverflowModeFill, GTextAlignmentCenter, NULL);
  }
  graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(GColorDarkGray, GColorBlack));
  graphics_fill_rect(ctx, GRect(m + pw + 8, py, pw, ph), ph / 2, GCornersAll);
  graphics_draw_round_rect(ctx, GRect(m + pw + 8, py, pw, ph), ph / 2);
  graphics_draw_text(ctx, "Retry", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(m + pw + 8, py + (ph - 22) / 2 - 2, pw, 22), GTextOverflowModeFill, GTextAlignmentCenter, NULL);
}

static void voice_start(void);

static void voice_undo(ClickRecognizerRef r, void *c) {
  if (s_v_state == 1 && s_v_undo) {
    send_cmd(CMD_UNDO, -1, -1);
    voice_show(0, false, "Undoing...", "");
  }
}
static void voice_retry(ClickRecognizerRef r, void *c) {
  if (window_stack_get_top_window() == s_voice_window) window_stack_pop(false);
  voice_start();
}
static void voice_done(ClickRecognizerRef r, void *c) { window_stack_pop(true); }
static void voice_click_config(void *c) {
  window_single_click_subscribe(BUTTON_ID_UP, voice_undo);
  window_single_click_subscribe(BUTTON_ID_DOWN, voice_retry);
  window_single_click_subscribe(BUTTON_ID_SELECT, voice_done);
}
static void voice_win_load(Window *w) {
  Layer *root = window_get_root_layer(w);
  s_voice_layer = layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_voice_layer, voice_draw);
  layer_add_child(root, s_voice_layer);
}
static void voice_win_unload(Window *w) {
  layer_destroy(s_voice_layer);
  s_voice_layer = NULL;
}
static void voice_win_disappear(Window *w) {
  if (s_v_timer) {
    app_timer_cancel(s_v_timer);
    s_v_timer = NULL;
  }
}

// ---------------------------------------------------------------- dictation

#ifdef PBL_MICROPHONE
static void dictation_cb(DictationSession *session, DictationSessionStatus status, char *transcription, void *ctx) {
  if (status == DictationSessionStatusSuccess && transcription) {
    copy_str(s_transcript, sizeof(s_transcript), transcription);
    send_say(s_transcript, ctx_room());
    char clipped[52], heard[TEXT_LEN];
    copy_str(clipped, sizeof(clipped), s_transcript);  // no printf precision: Pebble's snprintf is limited
    snprintf(heard, sizeof(heard), "\"%s\"", clipped);
    voice_show(0, false, "Working...", heard);
    return;
  }
  if (status == DictationSessionStatusFailureTranscriptionRejected) return;  // user cancelled
  if (status == DictationSessionStatusFailureConnectivityError || status == DictationSessionStatusFailureDisabled) {
    voice_show(2, false, "Voice needs your phone", "Check the Bluetooth link");
  } else {
    voice_show(2, false, "Didn't catch that", "Hold SELECT and try again");
  }
}
#endif

static void voice_start(void) {
#ifdef PBL_MICROPHONE
  if (!s_dict) {
    s_dict = dictation_session_create(SAY_LEN, dictation_cb, NULL);
    if (!s_dict) {
      voice_show(2, false, "Voice unavailable", "Not enough memory");
      return;
    }
    dictation_session_enable_confirmation(s_dict, false);  // the result card shows what was understood, with undo
  }
  dictation_session_start(s_dict);
#else
  voice_show(2, false, "No microphone", "This watch can't hear you");
#endif
}
static void voice_long(ClickRecognizerRef r, void *c) { voice_start(); }

// ---------------------------------------------------------------- "which one?" window

static uint16_t choice_rows(MenuLayer *l, uint16_t s, void *c) { return s_choice_count; }
static int16_t choice_header_h(MenuLayer *l, uint16_t s, void *c) { return MENU_CELL_BASIC_HEADER_HEIGHT; }
static void choice_header(GContext *g, const Layer *cell, uint16_t s, void *c) { menu_cell_basic_header_draw(g, cell, s_choice_prompt); }
static void choice_draw(GContext *g, const Layer *cell, MenuIndex *i, void *c) {
  menu_cell_basic_draw(g, cell, s_choice_name[i->row], s_choice_sub[i->row], NULL);
}
static void choice_select(MenuLayer *l, MenuIndex *i, void *c) {
  send_val(CMD_CHOOSE, i->row, 0);
  window_stack_pop(false);
  voice_show(0, false, "Working...", "");
}
static void choice_win_load(Window *w) {
  Layer *root = window_get_root_layer(w);
  s_choice_menu = menu_layer_create(layer_get_bounds(root));
  menu_layer_set_callbacks(s_choice_menu, NULL, (MenuLayerCallbacks){
    .get_num_rows = choice_rows, .get_header_height = choice_header_h, .draw_header = choice_header,
    .draw_row = choice_draw, .select_click = choice_select,
  });
  menu_layer_set_click_config_onto_window(s_choice_menu, w);
  layer_add_child(root, menu_layer_get_layer(s_choice_menu));
}
static void choice_win_unload(Window *w) {
  menu_layer_destroy(s_choice_menu);
  s_choice_menu = NULL;
}
static void choice_show(void) {
  if (!s_choice_window) {
    s_choice_window = window_create();
    window_set_window_handlers(s_choice_window, (WindowHandlers){.load = choice_win_load, .unload = choice_win_unload});
  }
  if (window_stack_get_top_window() == s_voice_window) window_stack_pop(false);
  if (window_stack_get_top_window() != s_choice_window) window_stack_push(s_choice_window, true);
  if (s_choice_menu) menu_layer_reload_data(s_choice_menu);
}

// ---------------------------------------------------------------- brightness screen

static void bright_flush(void) {
  if (s_bright_timer) {
    app_timer_cancel(s_bright_timer);
    s_bright_timer = NULL;
  }
  send_val(CMD_BRIGHT, s_bright_idx, s_bright_value);
}
static void bright_timer_fired(void *data) {
  s_bright_timer = NULL;
  send_val(CMD_BRIGHT, s_bright_idx, s_bright_value);
}
static void bright_step(int delta) {
  int v = clampi(s_bright_value + delta, 0, 100);
  if (v == s_bright_value) return;
  s_bright_value = v;
  layer_mark_dirty(s_bright_layer);
  if (s_bright_timer) app_timer_reschedule(s_bright_timer, SEND_DELAY_MS);
  else s_bright_timer = app_timer_register(SEND_DELAY_MS, bright_timer_fired, NULL);
}
static void bright_up(ClickRecognizerRef r, void *c) { bright_step(s_bright_step); }
static void bright_down(ClickRecognizerRef r, void *c) { bright_step(-s_bright_step); }
static void bright_select(ClickRecognizerRef r, void *c) {
  bright_flush();
  window_stack_pop(true);
}
static void bright_click_config(void *c) {
  window_single_repeating_click_subscribe(BUTTON_ID_UP, 150, bright_up);
  window_single_repeating_click_subscribe(BUTTON_ID_DOWN, 150, bright_down);
  window_single_click_subscribe(BUTTON_ID_SELECT, bright_select);
  window_long_click_subscribe(BUTTON_ID_SELECT, LONG_MS, voice_long, NULL);
}

// Layout (content area is below the status bar; h = screen height - 16):
//   name y = 4..32, percent y = h/2-28..+50, bar y = h-32..h-20. Basalt (h 152): 4-32, 48-98, 120-132.
static void bright_draw(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  int name_pad = PBL_IF_ROUND_ELSE(40, 6), bar_pad = PBL_IF_ROUND_ELSE(36, 14);
  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, s_bright_name, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD), GRect(name_pad, 4, b.size.w - 2 * name_pad, 28),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  char pct[8];
  snprintf(pct, sizeof(pct), "%d%%", s_bright_value);
  graphics_draw_text(ctx, pct, fonts_get_system_font(FONT_KEY_BITHAM_42_BOLD), GRect(0, b.size.h / 2 - 28, b.size.w, 50),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);
  GRect bar = GRect(bar_pad, b.size.h - 32, b.size.w - 2 * bar_pad, 12);
  graphics_context_set_stroke_color(ctx, GColorBlack);
  graphics_draw_rect(ctx, bar);
  GRect fill = GRect(bar.origin.x + 2, bar.origin.y + 2, (bar.size.w - 4) * s_bright_value / 100, bar.size.h - 4);
  graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(GColorChromeYellow, GColorBlack));
  graphics_fill_rect(ctx, fill, 0, GCornerNone);
}
static void bright_load(Window *w) {
  Layer *root = window_get_root_layer(w);
  GRect b = layer_get_bounds(root);
  s_bright_status = status_bar_layer_create();
  status_bar_layer_set_colors(s_bright_status, GColorWhite, GColorBlack);
  layer_add_child(root, status_bar_layer_get_layer(s_bright_status));
  s_bright_layer = layer_create(GRect(0, STATUS_BAR_LAYER_HEIGHT, b.size.w, b.size.h - STATUS_BAR_LAYER_HEIGHT));
  layer_set_update_proc(s_bright_layer, bright_draw);
  layer_add_child(root, s_bright_layer);
}
static void bright_disappear(Window *w) {
  if (s_bright_timer) bright_flush();  // don't lose the last change if the user backs out early
}
static void bright_unload(Window *w) {
  layer_destroy(s_bright_layer);
  s_bright_layer = NULL;
  status_bar_layer_destroy(s_bright_status);
  s_bright_status = NULL;
}
static void open_brightness(void) {
  if (!s_bright_window) {
    s_bright_window = window_create();
    window_set_background_color(s_bright_window, GColorWhite);
    window_set_click_config_provider(s_bright_window, bright_click_config);
    window_set_window_handlers(s_bright_window, (WindowHandlers){.load = bright_load, .disappear = bright_disappear, .unload = bright_unload});
  }
  if (window_stack_get_top_window() == s_bright_window) {
    if (s_bright_layer) layer_mark_dirty(s_bright_layer);
  } else {
    window_stack_push(s_bright_window, true);
  }
}

// ---------------------------------------------------------------- thermostat screen

static void th_flush_temp(void) {
  if (s_th_timer) {
    app_timer_cancel(s_th_timer);
    s_th_timer = NULL;
    send_val(CMD_TEMP, s_th_idx, s_th_set);
  }
}
static void th_timer_fired(void *d) {
  s_th_timer = NULL;
  send_val(CMD_TEMP, s_th_idx, s_th_set);
}
static void th_step(int delta) {
  int v = clampi(s_th_set + delta, TEMP_MIN, TEMP_MAX);
  if (v == s_th_set) return;
  s_th_set = v;
  layer_mark_dirty(s_th_layer);
  if (s_th_timer) app_timer_reschedule(s_th_timer, SEND_DELAY_MS);
  else s_th_timer = app_timer_register(SEND_DELAY_MS, th_timer_fired, NULL);
}
static void th_up(ClickRecognizerRef r, void *c) { th_step(s_th_step); }
static void th_down(ClickRecognizerRef r, void *c) { th_step(-s_th_step); }
static void th_mode(ClickRecognizerRef r, void *c) {
  th_flush_temp();
  s_th_mode = (s_th_mode + 1) % 4;
  layer_mark_dirty(s_th_layer);
  send_val(CMD_MODE, s_th_idx, s_th_mode);
}
static void th_click_config(void *c) {
  window_single_repeating_click_subscribe(BUTTON_ID_UP, 120, th_up);
  window_single_repeating_click_subscribe(BUTTON_ID_DOWN, 120, th_down);
  window_single_click_subscribe(BUTTON_ID_SELECT, th_mode);
  window_long_click_subscribe(BUTTON_ID_SELECT, LONG_MS, voice_long, NULL);
}

// Laid out from the bottom up so it fits 152 px (basalt) to 212 px (emery) of content:
//   mode chips y = h-30 (24 tall), range track y = chips-12, big set point and "now" line centred above the track.
static void th_draw(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  int m = PBL_IF_ROUND_ELSE(18, 4);
  GColor heat = PBL_IF_COLOR_ELSE(GColorOrange, GColorBlack);

  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, "Thermostat", fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD), GRect(0, 0, b.size.w, 18),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);
  graphics_context_set_text_color(ctx, PBL_IF_COLOR_ELSE(GColorDarkGray, GColorBlack));
  graphics_draw_text(ctx, s_th_name, fonts_get_system_font(FONT_KEY_GOTHIC_14), GRect(0, 16, b.size.w, 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

  int chips_y = b.size.h - 30, track_y = chips_y - 12;
  int ny = 38 + (track_y - 38 - 72) / 2;
  if (ny < 34) ny = 34;

  char buf[24];
  snprintf(buf, sizeof(buf), "%d\xC2\xB0", s_th_set);
  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, buf, fonts_get_system_font(FONT_KEY_BITHAM_42_BOLD), GRect(0, ny, b.size.w, 50), GTextOverflowModeFill,
                     GTextAlignmentCenter, NULL);
  if (s_th_temp >= 0) snprintf(buf, sizeof(buf), "Now %d\xC2\xB0", s_th_temp);
  else snprintf(buf, sizeof(buf), "%s", MODE_NAMES[s_th_mode]);
  graphics_context_set_text_color(ctx, heat);
  graphics_draw_text(ctx, buf, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(0, ny + 48, b.size.w, 24), GTextOverflowModeFill,
                     GTextAlignmentCenter, NULL);

  // Range track 60-80 F with the set point and the current temperature marked.
  int tx0 = m + 16, tx1 = b.size.w - m - 16, tw = tx1 - tx0;
  graphics_context_set_fill_color(ctx, GColorLightGray);
  graphics_fill_rect(ctx, GRect(tx0, track_y, tw, 4), 0, GCornerNone);
  int sx = tx0 + tw * (clampi(s_th_set, 60, 80) - 60) / 20;
  graphics_context_set_fill_color(ctx, heat);
  graphics_fill_rect(ctx, GRect(tx0, track_y, sx - tx0, 4), 0, GCornerNone);
  graphics_fill_circle(ctx, GPoint(sx, track_y + 2), 6);
  if (s_th_temp >= 0) {
    int nx = tx0 + tw * (clampi(s_th_temp, 60, 80) - 60) / 20;
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_circle(ctx, GPoint(nx, track_y + 2), 3);
  }

  int cw = (b.size.w - 2 * m - 3 * 3) / 4;
  for (int i = 0; i < 4; i++) {
    GRect chip = GRect(m + i * (cw + 3), chips_y, cw, 24);
    bool on = i == s_th_mode;
    graphics_context_set_fill_color(ctx, on ? heat : GColorWhite);
    graphics_fill_rect(ctx, chip, 12, GCornersAll);
    graphics_context_set_stroke_color(ctx, on ? heat : GColorBlack);
    graphics_context_set_stroke_width(ctx, 1);
    graphics_draw_round_rect(ctx, chip, 12);
    graphics_context_set_text_color(ctx, on ? GColorWhite : GColorBlack);
    graphics_draw_text(ctx, MODE_NAMES[i], fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                       GRect(chip.origin.x, chip.origin.y + 2, chip.size.w, 20), GTextOverflowModeFill, GTextAlignmentCenter, NULL);
  }
}
static void th_load(Window *w) {
  Layer *root = window_get_root_layer(w);
  GRect b = layer_get_bounds(root);
  s_th_status = status_bar_layer_create();
  status_bar_layer_set_colors(s_th_status, GColorWhite, GColorBlack);
  layer_add_child(root, status_bar_layer_get_layer(s_th_status));
  s_th_layer = layer_create(GRect(0, STATUS_BAR_LAYER_HEIGHT, b.size.w, b.size.h - STATUS_BAR_LAYER_HEIGHT));
  layer_set_update_proc(s_th_layer, th_draw);
  layer_add_child(root, s_th_layer);
}
static void th_disappear(Window *w) { th_flush_temp(); }
static void th_unload(Window *w) {
  layer_destroy(s_th_layer);
  s_th_layer = NULL;
  status_bar_layer_destroy(s_th_status);
  s_th_status = NULL;
}
static void open_thermostat(void) {
  if (!s_th_window) {
    s_th_window = window_create();
    window_set_background_color(s_th_window, GColorWhite);
    window_set_click_config_provider(s_th_window, th_click_config);
    window_set_window_handlers(s_th_window, (WindowHandlers){.load = th_load, .disappear = th_disappear, .unload = th_unload});
  }
  if (window_stack_get_top_window() == s_th_window) {
    if (s_th_layer) layer_mark_dirty(s_th_layer);
  } else {
    window_stack_push(s_th_window, true);
  }
}

// ---------------------------------------------------------------- list windows (Home, All rooms, one room)

static void lw_refresh(ListWin *lw) {
  if (!lw->menu) return;
  bool empty = lw->count == 0;
  layer_set_hidden(menu_layer_get_layer(lw->menu), empty);
  layer_set_hidden(text_layer_get_layer(lw->message), !empty);
  if (empty) text_layer_set_text(lw->message, s_status);
  menu_layer_reload_data(lw->menu);
}

static uint16_t list_num_rows(MenuLayer *l, uint16_t s, void *data) { return ((ListWin *)data)->count; }
static int16_t list_header_h(MenuLayer *l, uint16_t s, void *data) { return MENU_CELL_BASIC_HEADER_HEIGHT; }
static int16_t list_cell_h(MenuLayer *l, MenuIndex *i, void *data) { return ROW_H; }
static void list_header(GContext *g, const Layer *cell, uint16_t s, void *data) {
  menu_cell_basic_header_draw(g, cell, ((ListWin *)data)->title);
}

// One line per row: a state dot, the name, and the state on the right. Dot colours: yellow = on, hollow = off,
// grey = offline, orange = thermostat, blue = scene.
static void list_draw_row(GContext *g, const Layer *cell, MenuIndex *index, void *data) {
  const Row *r = &((ListWin *)data)->rows[index->row];
  GRect b = layer_get_bounds(cell);
  bool hl = menu_cell_layer_is_highlighted(cell);
  GColor fg = hl ? GColorWhite : GColorBlack;
  GPoint dot = GPoint(12, b.size.h / 2);

  if (r->type == TYPE_LIGHT || r->type == TYPE_ROOM || r->type == TYPE_ALL_OFF) {
    if (r->state == 1) {
      graphics_context_set_fill_color(g, PBL_IF_COLOR_ELSE(r->type == TYPE_ALL_OFF ? GColorSunsetOrange : GColorChromeYellow, fg));
      graphics_fill_circle(g, dot, 6);
    } else if (r->state == 2) {
      graphics_context_set_fill_color(g, PBL_IF_COLOR_ELSE(GColorDarkGray, fg));
      graphics_fill_circle(g, dot, 4);
    } else {
      graphics_context_set_stroke_color(g, PBL_IF_COLOR_ELSE(hl ? GColorLightGray : GColorDarkGray, fg));
      graphics_context_set_stroke_width(g, 2);
      graphics_draw_circle(g, dot, 5);
    }
  } else if (r->type == TYPE_THERMO) {
    graphics_context_set_fill_color(g, PBL_IF_COLOR_ELSE(GColorOrange, fg));
    graphics_fill_circle(g, dot, 6);
  } else if (r->type == TYPE_SCENE) {
    graphics_context_set_fill_color(g, PBL_IF_COLOR_ELSE(GColorVividCerulean, fg));
    graphics_fill_circle(g, dot, 6);
  }

  GFont small = fonts_get_system_font(FONT_KEY_GOTHIC_14);
  GSize sz = graphics_text_layout_get_content_size(r->sub, small, GRect(0, 0, b.size.w / 2, 20), GTextOverflowModeFill, GTextAlignmentRight);
  int tx = r->type == TYPE_MORE ? 8 : 24;
  graphics_context_set_text_color(g, fg);
  graphics_draw_text(g, r->title, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(tx, (b.size.h - 22) / 2 - 3, b.size.w - tx - sz.w - 12, 22), GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
  graphics_context_set_text_color(g, hl ? GColorLightGray : GColorDarkGray);
  graphics_draw_text(g, r->sub, small, GRect(b.size.w - sz.w - 10, (b.size.h - 18) / 2 - 1, sz.w + 4, 18), GTextOverflowModeFill,
                     GTextAlignmentRight, NULL);
}

static int selected_row(ListWin *lw) { return menu_layer_get_selected_index(lw->menu).row; }
static void select_row(ListWin *lw, int row) {
  menu_layer_set_selected_index(lw->menu, MenuIndex(0, row), MenuRowAlignCenter, true);
}

static void lw_up(ClickRecognizerRef r, void *ctx) {
  ListWin *lw = lw_of_window((Window *)ctx);
  if (!lw || lw->count == 0) return;
  int row = selected_row(lw);
  select_row(lw, row == 0 ? lw->count - 1 : row - 1);  // wraps, so "All rooms" is one press from the top
}
static void lw_down(ClickRecognizerRef r, void *ctx) {
  ListWin *lw = lw_of_window((Window *)ctx);
  if (!lw || lw->count == 0) return;
  int row = selected_row(lw);
  select_row(lw, row >= lw->count - 1 ? 0 : row + 1);
}

// Show the result of a tap straight away; the phone confirms (or corrects) with fresh rows.
static void optimistic(ListWin *lw, int row) {
  Row *r = &lw->rows[row];
  if (r->type == TYPE_LIGHT || r->type == TYPE_ROOM) {
    if (r->state == 2) return;
    r->state = r->state == 1 ? 0 : 1;
    copy_str(r->sub, SUB_LEN, r->state ? "On" : "Off");
  } else if (r->type == TYPE_ALL_OFF) {
    for (int i = 0; i < lw->count; i++) {
      if ((lw->rows[i].type == TYPE_LIGHT || lw->rows[i].type == TYPE_ROOM || lw->rows[i].type == TYPE_ALL_OFF) && lw->rows[i].state == 1) {
        lw->rows[i].state = 0;
        copy_str(lw->rows[i].sub, SUB_LEN, i == row ? "" : "Off");
      }
    }
    vibes_short_pulse();
  } else if (r->type == TYPE_SCENE) {
    vibes_short_pulse();
  }
  menu_layer_reload_data(lw->menu);
}

static void lw_tap(ClickRecognizerRef r, void *ctx) {
  ListWin *lw = lw_of_window((Window *)ctx);
  if (!lw) return;
  if (lw->count == 0) {
    send_cmd(CMD_REFRESH, -1, -1);
    return;
  }
  int row = selected_row(lw);
  optimistic(lw, row);
  send_cmd(CMD_TAP, lw->list_id, row);
}
static void lw_hold_up(ClickRecognizerRef r, void *ctx) {
  ListWin *lw = lw_of_window((Window *)ctx);
  if (!lw || lw->count == 0) return;
  int row = selected_row(lw);
  if (!lw->rows[row].adj && lw->rows[row].type != TYPE_MORE) {
    vibes_short_pulse();  // nothing to fine-tune here (offline, can't dim, or a scene)
    return;
  }
  send_cmd(CMD_HOLD, lw->list_id, row);
}
static void lw_click_config(void *ctx) {
  window_single_click_subscribe(BUTTON_ID_UP, lw_up);
  window_single_click_subscribe(BUTTON_ID_DOWN, lw_down);
  window_single_click_subscribe(BUTTON_ID_SELECT, lw_tap);
  window_long_click_subscribe(BUTTON_ID_SELECT, LONG_MS, voice_long, NULL);
  window_long_click_subscribe(BUTTON_ID_UP, LONG_MS, lw_hold_up, NULL);
}

static void lw_load(Window *w) {
  ListWin *lw = (ListWin *)window_get_user_data(w);
  Layer *root = window_get_root_layer(w);
  GRect b = layer_get_bounds(root);
  GRect area = GRect(0, STATUS_BAR_LAYER_HEIGHT, b.size.w, b.size.h - STATUS_BAR_LAYER_HEIGHT);

  lw->status_bar = status_bar_layer_create();
  status_bar_layer_set_colors(lw->status_bar, GColorWhite, GColorBlack);
  layer_add_child(root, status_bar_layer_get_layer(lw->status_bar));

  lw->menu = menu_layer_create(area);
  menu_layer_set_normal_colors(lw->menu, GColorWhite, GColorBlack);
  menu_layer_set_highlight_colors(lw->menu, GColorBlack, GColorWhite);
  menu_layer_set_callbacks(lw->menu, lw, (MenuLayerCallbacks){
    .get_num_rows = list_num_rows, .get_header_height = list_header_h, .get_cell_height = list_cell_h,
    .draw_header = list_header, .draw_row = list_draw_row,
  });
  layer_add_child(root, menu_layer_get_layer(lw->menu));

  lw->message = text_layer_create(GRect(10, area.origin.y + area.size.h / 2 - 50, b.size.w - 20, 100));
  text_layer_set_text_alignment(lw->message, GTextAlignmentCenter);
  text_layer_set_font(lw->message, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD));
  layer_add_child(root, text_layer_get_layer(lw->message));
  lw_refresh(lw);
}
static void lw_unload(Window *w) {
  ListWin *lw = (ListWin *)window_get_user_data(w);
  if (lw->list_id != 0) send_cmd(CMD_CLOSED, lw->list_id, -1);  // the phone stops updating a list nobody is looking at
  menu_layer_destroy(lw->menu);
  text_layer_destroy(lw->message);
  status_bar_layer_destroy(lw->status_bar);
  lw->menu = NULL;
  lw->message = NULL;
  lw->status_bar = NULL;
  lw->in_use = false;
}

static ListWin *lw_push(int id, const char *title) {
  ListWin *lw = lw_find(id);
  if (lw) return lw;  // already open
  for (int i = 0; i < MAX_LISTS && !lw; i++) {
    if (!s_lw[i].in_use) lw = &s_lw[i];
  }
  if (!lw) return NULL;
  if (!lw->window) {
    lw->window = window_create();
    window_set_background_color(lw->window, GColorWhite);
    window_set_user_data(lw->window, lw);
    window_set_click_config_provider(lw->window, lw_click_config);
    window_set_window_handlers(lw->window, (WindowHandlers){.load = lw_load, .unload = lw_unload});
  }
  lw->in_use = true;
  lw->list_id = id;
  lw->count = 0;
  lw->room = -1;
  memset(lw->rows, 0, sizeof(lw->rows));
  copy_str(lw->title, TITLE_LEN, title);
  window_stack_push(lw->window, id != 0);
  return lw;
}

// ---------------------------------------------------------------- phone messages

static void inbox_received(DictionaryIterator *it, void *ctx) {
  switch (get_int(it, MESSAGE_KEY_kind, -1)) {
    case KIND_LIST: {
      ListWin *lw = lw_find(get_int(it, MESSAGE_KEY_list, -1));
      if (!lw) return;
      lw->count = clampi(get_int(it, MESSAGE_KEY_count, 0), 0, MAX_ROWS);
      lw->room = get_int(it, MESSAGE_KEY_room, -1);
      copy_str(lw->title, TITLE_LEN, get_str(it, MESSAGE_KEY_text));
      memset(lw->rows, 0, sizeof(lw->rows));
      lw_refresh(lw);
      break;
    }
    case KIND_ROW: {
      ListWin *lw = lw_find(get_int(it, MESSAGE_KEY_list, -1));
      int i = get_int(it, MESSAGE_KEY_idx, -1);
      if (!lw || i < 0 || i >= lw->count) return;
      Row *r = &lw->rows[i];
      copy_str(r->title, TITLE_LEN, get_str(it, MESSAGE_KEY_name));
      copy_str(r->sub, SUB_LEN, get_str(it, MESSAGE_KEY_sub));
      r->state = (int8_t)get_int(it, MESSAGE_KEY_state, 3);
      r->type = (int8_t)get_int(it, MESSAGE_KEY_type, 0);
      r->adj = (int8_t)get_int(it, MESSAGE_KEY_adj, 0);
      if (lw->menu) menu_layer_reload_data(lw->menu);
      break;
    }
    case KIND_OPEN:
      lw_push(get_int(it, MESSAGE_KEY_list, -1), get_str(it, MESSAGE_KEY_text));
      break;
    case KIND_BRIGHT:
      s_bright_idx = get_int(it, MESSAGE_KEY_idx, -1);
      s_bright_value = clampi(get_int(it, MESSAGE_KEY_value, 0), 0, 100);
      s_bright_step = clampi(get_int(it, MESSAGE_KEY_adj, 10), 1, 50);
      s_bright_room = get_int(it, MESSAGE_KEY_room, -1);
      copy_str(s_bright_name, TITLE_LEN, get_str(it, MESSAGE_KEY_name));
      if (s_bright_idx >= 0) open_brightness();
      break;
    case KIND_THERMO:
      s_th_idx = get_int(it, MESSAGE_KEY_idx, -1);
      s_th_set = clampi(get_int(it, MESSAGE_KEY_set, 70), TEMP_MIN, TEMP_MAX);
      s_th_temp = get_int(it, MESSAGE_KEY_temp, -1);
      s_th_mode = clampi(get_int(it, MESSAGE_KEY_mode, 0), 0, 3);
      s_th_step = clampi(get_int(it, MESSAGE_KEY_adj, 1), 1, 5);
      s_th_room = get_int(it, MESSAGE_KEY_room, -1);
      copy_str(s_th_name, TITLE_LEN, get_str(it, MESSAGE_KEY_name));
      if (s_th_idx >= 0) open_thermostat();
      break;
    case KIND_STATUS: {
      copy_str(s_status, sizeof(s_status), get_str(it, MESSAGE_KEY_text));
      ListWin *home = lw_find(0);
      if (home) {
        home->count = 0;
        lw_refresh(home);
      }
      break;
    }
    case KIND_RESULT: {
      bool ok = get_int(it, MESSAGE_KEY_ok, 0) != 0;
      voice_show(ok ? 1 : 2, get_int(it, MESSAGE_KEY_undo, 0) != 0, get_str(it, MESSAGE_KEY_text), get_str(it, MESSAGE_KEY_sub));
      if (ok) vibes_short_pulse();
      break;
    }
    case KIND_CHOICE: {
      int i = get_int(it, MESSAGE_KEY_idx, -1);
      if (i < 0 || i >= MAX_CHOICES) return;
      if (i == 0) {
        s_choice_count = clampi(get_int(it, MESSAGE_KEY_count, 1), 1, MAX_CHOICES);
        copy_str(s_choice_prompt, sizeof(s_choice_prompt), get_str(it, MESSAGE_KEY_text));
      }
      copy_str(s_choice_name[i], sizeof(s_choice_name[i]), get_str(it, MESSAGE_KEY_name));
      copy_str(s_choice_sub[i], sizeof(s_choice_sub[i]), get_str(it, MESSAGE_KEY_sub));
      choice_show();
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------- lifecycle

static void init(void) {
  // Callbacks first, then open. Inbox holds one phone message (the longest is a result card), outbox one command
  // or one spoken sentence.
  app_message_register_inbox_received(inbox_received);
  app_message_register_outbox_failed(outbox_failed);
  app_message_open(256, 200);

  s_voice_window = window_create();
  window_set_background_color(s_voice_window, GColorBlack);
  window_set_click_config_provider(s_voice_window, voice_click_config);
  window_set_window_handlers(s_voice_window, (WindowHandlers){
    .load = voice_win_load, .disappear = voice_win_disappear, .unload = voice_win_unload,
  });

  lw_push(0, "Home");
}

static void deinit(void) {
#ifdef PBL_MICROPHONE
  if (s_dict) dictation_session_destroy(s_dict);
#endif
  if (s_v_timer) app_timer_cancel(s_v_timer);
  if (s_choice_window) window_destroy(s_choice_window);
  if (s_voice_window) window_destroy(s_voice_window);
  if (s_th_window) window_destroy(s_th_window);
  if (s_bright_window) window_destroy(s_bright_window);
  for (int i = 0; i < MAX_LISTS; i++) {
    if (s_lw[i].window) window_destroy(s_lw[i].window);
  }
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
