// Home Lights 2, "Rooms". Rooms grid -> room (lights + thermostat) -> thermostat / brightness, plus voice.
// The phone side (src/pkjs/index.js) talks to the Google Home plugin; the message protocol is described there.
//
//   Rooms grid     UP/DOWN pick a room, SELECT opens it, hold SELECT turns the room off (or on), hold DOWN talks
//   Room           UP/DOWN pick a row, SELECT toggles a light or opens the thermostat,
//                  hold SELECT = brightness, hold DOWN = talk
//   Thermostat     UP/DOWN change the set point 1 degree (hold to repeat), SELECT cycles the mode, hold SELECT = talk
//   Brightness     UP/DOWN change by 10%, SELECT applies, BACK applies and leaves
//   Voice result   UP = undo, DOWN = try again, SELECT = done
#include <pebble.h>

#define MAX_ROOMS 8
#define MAX_LIGHTS 24
#define MAX_CHOICES 4
#define NAME_LEN 41
#define TEXT_LEN 64
#define SAY_LEN 120

#define KIND_BEGIN 0
#define KIND_ROOM 1
#define KIND_LIGHT 2
#define KIND_RESULT 4
#define KIND_STATUS 5
#define KIND_CHOICE 6

#define CMD_TOGGLE 1
#define CMD_BRIGHT 2
#define CMD_ROOM_TOGGLE 3
#define CMD_REFRESH 4
#define CMD_TEMP 5
#define CMD_MODE 6
#define CMD_VOICE 7
#define CMD_UNDO 8
#define CMD_CHOOSE 9

#define BRIGHT_STEP 10
#define BRIGHT_REPEAT_MS 150
#define SEND_DELAY_MS 650
#define TEMP_MIN 50
#define TEMP_MAX 90
#define VOICE_CLOSE_MS 12000
#define LONG_MS 500

typedef struct {
  char name[NAME_LEN];
  int8_t first, count;
  bool thermo;
  int16_t temp;  // current room temperature in F, -1 unknown
  int16_t set;   // thermostat set point in F
  int8_t mode;   // 0 heat, 1 cool, 2 eco, 3 off
} Room;

typedef struct {
  char name[NAME_LEN];
  int8_t room;
  int8_t state;    // 0 off, 1 on, 2 offline
  int16_t bright;  // 0-100, -1 not dimmable
} Light;

static const char *MODE_NAMES[] = {"Heat", "Cool", "Eco", "Off"};

static Room s_rooms[MAX_ROOMS];
static Light s_lights[MAX_LIGHTS];
static int s_room_count = 0;
static int s_light_count = 0;
static char s_status[TEXT_LEN] = "Loading lights...";
static int s_ctx_room = -1;  // the room the visible screen is about; sent with voice commands

// Windows and layers
static Window *s_main_window;
static StatusBarLayer *s_main_status;
static Layer *s_grid;
static int s_sel_room = 0;

static Window *s_room_window;
static StatusBarLayer *s_room_status;
static MenuLayer *s_room_menu;
static int s_cur_room = 0;

static Window *s_th_window;
static StatusBarLayer *s_th_status;
static Layer *s_th_layer;
static int s_th_room = 0;
static AppTimer *s_th_timer;

static Window *s_bright_window;
static StatusBarLayer *s_bright_status;
static Layer *s_bright_layer;
static int s_bright_idx = -1;
static int s_bright_value = 0;
static AppTimer *s_bright_timer;

static Window *s_voice_window;
static Layer *s_voice_layer;
static int s_v_state = 0;  // 0 working, 1 done, 2 problem
static bool s_v_undo = false;
static char s_v_title[TEXT_LEN];
static char s_v_sub[TEXT_LEN];
static AppTimer *s_v_timer;

static Window *s_choice_window;
static MenuLayer *s_choice_menu;
static char s_choice_prompt[TEXT_LEN] = "Which one?";
static char s_choice_name[MAX_CHOICES][NAME_LEN];
static char s_choice_sub[MAX_CHOICES][NAME_LEN];
static int s_choice_count = 0;

#ifdef PBL_MICROPHONE
static DictationSession *s_dict;
static char s_transcript[SAY_LEN];
#endif

// ---------------------------------------------------------------- small helpers

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

static int room_on_count(int r) {
  int n = 0;
  for (int i = 0; i < s_rooms[r].count; i++) {
    int j = s_rooms[r].first + i;
    if (j >= 0 && j < s_light_count && s_lights[j].state == 1) n++;
  }
  return n;
}

static void mark_all_dirty(void) {
  if (s_grid) layer_mark_dirty(s_grid);
  if (s_room_menu) menu_layer_reload_data(s_room_menu);
  if (s_th_layer) layer_mark_dirty(s_th_layer);
  if (s_bright_layer) layer_mark_dirty(s_bright_layer);
}

// ---------------------------------------------------------------- talking to the phone

static void send_cmd(int cmd, int idx, int value) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    vibes_short_pulse();  // phone link busy or down: the press didn't go through
    return;
  }
  dict_write_int32(iter, MESSAGE_KEY_cmd, cmd);
  if (idx >= 0) dict_write_int32(iter, MESSAGE_KEY_idx, idx);
  if (value >= 0) dict_write_int32(iter, MESSAGE_KEY_value, value);
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
    // A "which one?" list under us would be stale now.
    if (s_choice_window && window_stack_get_top_window() == s_choice_window) window_stack_pop(false);
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
  const char *left = (s_v_state == 1 && s_v_undo) ? "Undo" : "";
  graphics_context_set_text_color(ctx, GColorWhite);
  if (left[0]) {
    graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(GColorDarkGray, GColorBlack));
    graphics_context_set_stroke_color(ctx, GColorWhite);
    graphics_context_set_stroke_width(ctx, 1);
    graphics_fill_rect(ctx, GRect(m, py, pw, ph), ph / 2, GCornersAll);
    graphics_draw_round_rect(ctx, GRect(m, py, pw, ph), ph / 2);
    graphics_draw_text(ctx, left, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(m, py + (ph - 22) / 2 - 2, pw, 22),
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
    send_say(s_transcript, s_ctx_room);
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
    voice_show(2, false, "Didn't catch that", "Hold the button and try again");
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

// ---------------------------------------------------------------- choice window ("which one?")

static uint16_t choice_rows(MenuLayer *l, uint16_t s, void *c) { return s_choice_count; }
static int16_t choice_header_h(MenuLayer *l, uint16_t s, void *c) { return MENU_CELL_BASIC_HEADER_HEIGHT; }
static void choice_header(GContext *g, const Layer *cell, uint16_t s, void *c) {
  menu_cell_basic_header_draw(g, cell, s_choice_prompt);
}
static void choice_draw(GContext *g, const Layer *cell, MenuIndex *i, void *c) {
  menu_cell_basic_draw(g, cell, s_choice_name[i->row], s_choice_sub[i->row], NULL);
}
static void choice_select(MenuLayer *l, MenuIndex *i, void *c) {
  send_cmd(CMD_CHOOSE, i->row, -1);
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

// ---------------------------------------------------------------- phone messages

static void inbox_received(DictionaryIterator *it, void *ctx) {
  switch (get_int(it, MESSAGE_KEY_kind, -1)) {
    case KIND_BEGIN:
      s_room_count = clampi(get_int(it, MESSAGE_KEY_rooms, 0), 0, MAX_ROOMS);
      s_light_count = clampi(get_int(it, MESSAGE_KEY_lights, 0), 0, MAX_LIGHTS);
      memset(s_rooms, 0, sizeof(s_rooms));
      memset(s_lights, 0, sizeof(s_lights));
      s_sel_room = clampi(s_sel_room, 0, s_room_count > 0 ? s_room_count - 1 : 0);
      break;
    case KIND_ROOM: {
      int i = get_int(it, MESSAGE_KEY_idx, -1);
      if (i < 0 || i >= MAX_ROOMS) return;
      Room *r = &s_rooms[i];
      copy_str(r->name, NAME_LEN, get_str(it, MESSAGE_KEY_name));
      r->first = (int8_t)clampi(get_int(it, MESSAGE_KEY_first, 0), 0, MAX_LIGHTS);
      r->count = (int8_t)clampi(get_int(it, MESSAGE_KEY_count, 0), 0, MAX_LIGHTS);
      r->thermo = get_int(it, MESSAGE_KEY_thermo, 0) != 0;
      r->temp = (int16_t)get_int(it, MESSAGE_KEY_temp, -1);
      r->set = (int16_t)get_int(it, MESSAGE_KEY_set, 0);
      r->mode = (int8_t)clampi(get_int(it, MESSAGE_KEY_mode, 0), 0, 3);
      break;
    }
    case KIND_LIGHT: {
      int i = get_int(it, MESSAGE_KEY_idx, -1);
      if (i < 0 || i >= MAX_LIGHTS) return;
      Light *l = &s_lights[i];
      copy_str(l->name, NAME_LEN, get_str(it, MESSAGE_KEY_name));
      l->room = (int8_t)get_int(it, MESSAGE_KEY_room, 0);
      l->state = (int8_t)get_int(it, MESSAGE_KEY_state, 0);
      l->bright = (int16_t)get_int(it, MESSAGE_KEY_bright, -1);
      if (i == s_bright_idx && s_bright_layer && !s_bright_timer && l->bright >= 0) s_bright_value = l->bright;
      break;
    }
    case KIND_STATUS:
      s_room_count = 0;
      copy_str(s_status, sizeof(s_status), get_str(it, MESSAGE_KEY_text));
      break;
    case KIND_RESULT: {
      bool ok = get_int(it, MESSAGE_KEY_ok, 0) != 0;
      voice_show(ok ? 1 : 2, get_int(it, MESSAGE_KEY_undo, 0) != 0, get_str(it, MESSAGE_KEY_text), get_str(it, MESSAGE_KEY_sub));
      if (ok) vibes_short_pulse();
      return;
    }
    case KIND_CHOICE: {
      int i = get_int(it, MESSAGE_KEY_idx, -1);
      if (i < 0 || i >= MAX_CHOICES) return;
      if (i == 0) {
        s_choice_count = clampi(get_int(it, MESSAGE_KEY_count, 1), 1, MAX_CHOICES);
        copy_str(s_choice_prompt, sizeof(s_choice_prompt), get_str(it, MESSAGE_KEY_text));
      }
      copy_str(s_choice_name[i], NAME_LEN, get_str(it, MESSAGE_KEY_name));
      copy_str(s_choice_sub[i], NAME_LEN, get_str(it, MESSAGE_KEY_sub));
      choice_show();
      return;
    }
    default:
      return;
  }
  mark_all_dirty();
}

// ---------------------------------------------------------------- brightness window

static void bright_flush(void) {
  if (s_bright_timer) {
    app_timer_cancel(s_bright_timer);
    s_bright_timer = NULL;
  }
  send_cmd(CMD_BRIGHT, s_bright_idx, s_bright_value);
}

static void bright_timer_fired(void *data) {
  s_bright_timer = NULL;
  send_cmd(CMD_BRIGHT, s_bright_idx, s_bright_value);
}

static void bright_step(int delta) {
  int v = clampi(s_bright_value + delta, 0, 100);
  if (v == s_bright_value) return;
  s_bright_value = v;
  s_lights[s_bright_idx].bright = v;
  layer_mark_dirty(s_bright_layer);
  if (s_bright_timer) {
    app_timer_reschedule(s_bright_timer, SEND_DELAY_MS);
  } else {
    s_bright_timer = app_timer_register(SEND_DELAY_MS, bright_timer_fired, NULL);
  }
}

static void bright_up(ClickRecognizerRef r, void *c) { bright_step(BRIGHT_STEP); }
static void bright_down(ClickRecognizerRef r, void *c) { bright_step(-BRIGHT_STEP); }
static void bright_select(ClickRecognizerRef r, void *c) {
  bright_flush();
  window_stack_pop(true);
}
static void bright_click_config(void *c) {
  window_single_repeating_click_subscribe(BUTTON_ID_UP, BRIGHT_REPEAT_MS, bright_up);
  window_single_repeating_click_subscribe(BUTTON_ID_DOWN, BRIGHT_REPEAT_MS, bright_down);
  window_single_click_subscribe(BUTTON_ID_SELECT, bright_select);
}

// Layout (content area is below the status bar; h = screen height - 16):
//   name y = 4..32, percent y = h/2-28..+50, bar y = h-32..h-20. Basalt (h 152): 4-32, 48-98, 120-132.
static void bright_draw(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  int name_pad = PBL_IF_ROUND_ELSE(40, 6);
  int bar_pad = PBL_IF_ROUND_ELSE(36, 14);

  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, s_lights[s_bright_idx].name, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                     GRect(name_pad, 4, b.size.w - 2 * name_pad, 28), GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter, NULL);
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
static void bright_appear(Window *w) { s_ctx_room = s_lights[s_bright_idx].room; }
static void bright_disappear(Window *w) {
  if (s_bright_timer) bright_flush();  // don't lose the last change if the user backs out early
}
static void bright_unload(Window *w) {
  layer_destroy(s_bright_layer);
  s_bright_layer = NULL;
  status_bar_layer_destroy(s_bright_status);
  s_bright_status = NULL;
}

static void open_brightness(int i) {
  s_bright_idx = i;
  s_bright_value = s_lights[i].bright;
  if (!s_bright_window) {
    s_bright_window = window_create();
    window_set_background_color(s_bright_window, GColorWhite);
    window_set_click_config_provider(s_bright_window, bright_click_config);
    window_set_window_handlers(s_bright_window, (WindowHandlers){
      .load = bright_load, .appear = bright_appear, .disappear = bright_disappear, .unload = bright_unload,
    });
  }
  window_stack_push(s_bright_window, true);
}

// ---------------------------------------------------------------- thermostat window

static void th_flush_temp(void) {
  if (s_th_timer) {
    app_timer_cancel(s_th_timer);
    s_th_timer = NULL;
    send_cmd(CMD_TEMP, s_th_room, s_rooms[s_th_room].set);
  }
}
static void th_timer_fired(void *d) {
  s_th_timer = NULL;
  send_cmd(CMD_TEMP, s_th_room, s_rooms[s_th_room].set);
}
static void th_step(int delta) {
  Room *r = &s_rooms[s_th_room];
  int v = clampi(r->set + delta, TEMP_MIN, TEMP_MAX);
  if (v == r->set) return;
  r->set = (int16_t)v;
  layer_mark_dirty(s_th_layer);
  if (s_th_timer) {
    app_timer_reschedule(s_th_timer, SEND_DELAY_MS);
  } else {
    s_th_timer = app_timer_register(SEND_DELAY_MS, th_timer_fired, NULL);
  }
}
static void th_up(ClickRecognizerRef r, void *c) { th_step(1); }
static void th_down(ClickRecognizerRef r, void *c) { th_step(-1); }
static void th_mode(ClickRecognizerRef r, void *c) {
  th_flush_temp();
  Room *rm = &s_rooms[s_th_room];
  rm->mode = (rm->mode + 1) % 4;
  layer_mark_dirty(s_th_layer);
  send_cmd(CMD_MODE, s_th_room, rm->mode);
}
static void th_click_config(void *c) {
  window_single_repeating_click_subscribe(BUTTON_ID_UP, 120, th_up);
  window_single_repeating_click_subscribe(BUTTON_ID_DOWN, 120, th_down);
  window_single_click_subscribe(BUTTON_ID_SELECT, th_mode);
  window_long_click_subscribe(BUTTON_ID_SELECT, LONG_MS, voice_long, NULL);
}

// Layout from the bottom up so it fits 152 px (basalt) to 212 px (emery) of content:
//   mode chips y = h-30 (24 tall), range track y = chips-12, big set point and "now" line centred above the track.
static void th_draw(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  const Room *r = &s_rooms[s_th_room];
  int m = PBL_IF_ROUND_ELSE(18, 4);
  GColor heat = PBL_IF_COLOR_ELSE(GColorOrange, GColorBlack);

  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, "Thermostat", fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD), GRect(0, 0, b.size.w, 18),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);
  graphics_context_set_text_color(ctx, PBL_IF_COLOR_ELSE(GColorDarkGray, GColorBlack));
  graphics_draw_text(ctx, r->name, fonts_get_system_font(FONT_KEY_GOTHIC_14), GRect(0, 16, b.size.w, 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

  int chips_y = b.size.h - 30, track_y = chips_y - 12;
  int avail = track_y - 38;
  int ny = 38 + (avail - 72) / 2;
  if (ny < 34) ny = 34;

  char buf[24];
  snprintf(buf, sizeof(buf), "%d\xC2\xB0", r->set);
  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, buf, fonts_get_system_font(FONT_KEY_BITHAM_42_BOLD), GRect(0, ny, b.size.w, 50),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);
  if (r->temp >= 0) snprintf(buf, sizeof(buf), "Now %d\xC2\xB0", r->temp);
  else snprintf(buf, sizeof(buf), "%s", MODE_NAMES[r->mode]);
  graphics_context_set_text_color(ctx, heat);
  graphics_draw_text(ctx, buf, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(0, ny + 48, b.size.w, 24),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);

  // Range track 60-80 F with the set point and the current temperature marked.
  int tx0 = m + 16, tx1 = b.size.w - m - 16, tw = tx1 - tx0;
  graphics_context_set_fill_color(ctx, GColorLightGray);
  graphics_fill_rect(ctx, GRect(tx0, track_y, tw, 4), 0, GCornerNone);
  int sx = tx0 + tw * (clampi(r->set, 60, 80) - 60) / 20;
  graphics_context_set_fill_color(ctx, heat);
  graphics_fill_rect(ctx, GRect(tx0, track_y, sx - tx0, 4), 0, GCornerNone);
  graphics_fill_circle(ctx, GPoint(sx, track_y + 2), 6);
  if (r->temp >= 0) {
    int nx = tx0 + tw * (clampi(r->temp, 60, 80) - 60) / 20;
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_circle(ctx, GPoint(nx, track_y + 2), 3);
  }

  int cw = (b.size.w - 2 * m - 3 * 3) / 4;
  for (int i = 0; i < 4; i++) {
    GRect chip = GRect(m + i * (cw + 3), chips_y, cw, 24);
    bool on = i == r->mode;
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
static void th_appear(Window *w) { s_ctx_room = s_th_room; }
static void th_disappear(Window *w) { th_flush_temp(); }
static void th_unload(Window *w) {
  layer_destroy(s_th_layer);
  s_th_layer = NULL;
  status_bar_layer_destroy(s_th_status);
  s_th_status = NULL;
}
static void open_thermostat(int room) {
  s_th_room = room;
  if (!s_th_window) {
    s_th_window = window_create();
    window_set_background_color(s_th_window, GColorWhite);
    window_set_click_config_provider(s_th_window, th_click_config);
    window_set_window_handlers(s_th_window, (WindowHandlers){
      .load = th_load, .appear = th_appear, .disappear = th_disappear, .unload = th_unload,
    });
  }
  window_stack_push(s_th_window, true);
}

// ---------------------------------------------------------------- room window

static int room_rows(int r) { return s_rooms[r].count + (s_rooms[r].thermo ? 1 : 0); }

static uint16_t room_num_rows(MenuLayer *l, uint16_t s, void *c) { return room_rows(s_cur_room); }
static int16_t room_header_h(MenuLayer *l, uint16_t s, void *c) { return MENU_CELL_BASIC_HEADER_HEIGHT; }

static void room_header(GContext *g, const Layer *cell, uint16_t s, void *c) {
  const Room *r = &s_rooms[s_cur_room];
  char title[64];
  if (r->thermo && r->temp >= 0) snprintf(title, sizeof(title), "%s  %d\xC2\xB0", r->name, r->temp);
  else snprintf(title, sizeof(title), "%s", r->name);
  menu_cell_basic_header_draw(g, cell, title);
}

static void room_draw_row(GContext *g, const Layer *cell, MenuIndex *index, void *c) {
  const Room *r = &s_rooms[s_cur_room];
  if (index->row >= r->count) {
    char sub[40];
    if (r->temp >= 0) snprintf(sub, sizeof(sub), "%d\xC2\xB0 now, set %d\xC2\xB0 %s", r->temp, r->set, MODE_NAMES[r->mode]);
    else snprintf(sub, sizeof(sub), "Set %d\xC2\xB0 %s", r->set, MODE_NAMES[r->mode]);
    menu_cell_basic_draw(g, cell, "Thermostat", sub, NULL);
    return;
  }
  const Light *l = &s_lights[r->first + index->row];
  char sub[24];
  if (l->state == 2) snprintf(sub, sizeof(sub), "Offline");
  else if (l->state == 1 && l->bright >= 0) snprintf(sub, sizeof(sub), "On %d%%", l->bright);
  else snprintf(sub, sizeof(sub), "%s", l->state == 1 ? "On" : "Off");
  menu_cell_basic_draw(g, cell, l->name, sub, NULL);
}

static void room_activate(int row) {
  const Room *r = &s_rooms[s_cur_room];
  if (row >= r->count) {
    open_thermostat(s_cur_room);
    return;
  }
  int j = r->first + row;
  if (s_lights[j].state != 2) {  // show the change straight away; the phone confirms
    s_lights[j].state = s_lights[j].state == 1 ? 0 : 1;
    mark_all_dirty();
  }
  send_cmd(CMD_TOGGLE, j, -1);
}

static void room_up(ClickRecognizerRef r, void *c) { menu_layer_set_selected_next(s_room_menu, true, MenuRowAlignCenter, true); }
static void room_down(ClickRecognizerRef r, void *c) { menu_layer_set_selected_next(s_room_menu, false, MenuRowAlignCenter, true); }
static void room_select(ClickRecognizerRef r, void *c) { room_activate(menu_layer_get_selected_index(s_room_menu).row); }
static void room_long_select(ClickRecognizerRef r, void *c) {
  const Room *rm = &s_rooms[s_cur_room];
  int row = menu_layer_get_selected_index(s_room_menu).row;
  if (row >= rm->count) return;
  int j = rm->first + row;
  if (s_lights[j].state == 2 || s_lights[j].bright < 0) {
    vibes_short_pulse();  // offline or not dimmable
    return;
  }
  open_brightness(j);
}
static void room_click_config(void *c) {
  window_single_repeating_click_subscribe(BUTTON_ID_UP, 120, room_up);
  window_single_click_subscribe(BUTTON_ID_DOWN, room_down);
  window_single_click_subscribe(BUTTON_ID_SELECT, room_select);
  window_long_click_subscribe(BUTTON_ID_SELECT, LONG_MS, room_long_select, NULL);
  window_long_click_subscribe(BUTTON_ID_DOWN, LONG_MS, voice_long, NULL);
}

static void room_load(Window *w) {
  Layer *root = window_get_root_layer(w);
  GRect b = layer_get_bounds(root);
  s_room_status = status_bar_layer_create();
  status_bar_layer_set_colors(s_room_status, GColorWhite, GColorBlack);
  layer_add_child(root, status_bar_layer_get_layer(s_room_status));
  s_room_menu = menu_layer_create(GRect(0, STATUS_BAR_LAYER_HEIGHT, b.size.w, b.size.h - STATUS_BAR_LAYER_HEIGHT));
  menu_layer_set_callbacks(s_room_menu, NULL, (MenuLayerCallbacks){
    .get_num_rows = room_num_rows, .get_header_height = room_header_h, .draw_header = room_header, .draw_row = room_draw_row,
  });
  layer_add_child(root, menu_layer_get_layer(s_room_menu));
}
static void room_appear(Window *w) { s_ctx_room = s_cur_room; }
static void room_unload(Window *w) {
  menu_layer_destroy(s_room_menu);
  s_room_menu = NULL;
  status_bar_layer_destroy(s_room_status);
  s_room_status = NULL;
}
static void open_room(int r) {
  s_cur_room = r;
  if (!s_room_window) {
    s_room_window = window_create();
    window_set_background_color(s_room_window, GColorWhite);
    window_set_click_config_provider(s_room_window, room_click_config);
    window_set_window_handlers(s_room_window, (WindowHandlers){.load = room_load, .appear = room_appear, .unload = room_unload});
  }
  window_stack_push(s_room_window, true);
}

// ---------------------------------------------------------------- rooms grid (home screen)

// Four tiles per page (2 x 2). Tile size comes from the screen: emery 94 x 93, basalt 66 x 63. The temperature line
// only appears when the tile is tall enough (>= 78 px).
static void grid_draw(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  graphics_context_set_text_color(ctx, GColorBlack);
  if (s_room_count == 0) {
    graphics_draw_text(ctx, s_status, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                       GRect(12, b.size.h / 2 - 50, b.size.w - 24, 90), GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentCenter, NULL);
    graphics_draw_text(ctx, "Select to retry", fonts_get_system_font(FONT_KEY_GOTHIC_14), GRect(0, b.size.h - 22, b.size.w, 18),
                       GTextOverflowModeFill, GTextAlignmentCenter, NULL);
    return;
  }
  int m = PBL_IF_ROUND_ELSE(16, 4), gap = 4, footer = 16;
  int tw = (b.size.w - 2 * m - gap) / 2;
  int th = (b.size.h - footer - 3 * gap) / 2;
  int page = s_sel_room / 4;

  for (int i = 0; i < 4; i++) {
    int r = page * 4 + i;
    if (r >= s_room_count) break;
    const Room *rm = &s_rooms[r];
    int on = room_on_count(r);
    int x = m + (i % 2) * (tw + gap), y = gap + (i / 2) * (th + gap);
    GRect tile = GRect(x, y, tw, th);

    graphics_context_set_fill_color(ctx, on > 0 ? PBL_IF_COLOR_ELSE(GColorRajah, GColorWhite) : GColorLightGray);
    graphics_fill_rect(ctx, tile, 6, GCornersAll);
    graphics_context_set_stroke_color(ctx, GColorBlack);
    graphics_context_set_stroke_width(ctx, r == s_sel_room ? 3 : 1);
    graphics_draw_round_rect(ctx, tile, 6);

    graphics_context_set_text_color(ctx, GColorBlack);
    graphics_draw_text(ctx, rm->name, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(x + 6, y + 1, tw - 10, 22),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    char big[8], cap[16];
    snprintf(big, sizeof(big), "%d", rm->count > 0 ? on : 0);
    snprintf(cap, sizeof(cap), "of %d on", rm->count);
    GFont bigf = fonts_get_system_font(FONT_KEY_BITHAM_30_BLACK);
    GSize bs = graphics_text_layout_get_content_size(big, bigf, GRect(0, 0, 80, 40), GTextOverflowModeFill, GTextAlignmentLeft);
    graphics_draw_text(ctx, big, bigf, GRect(x + 6, y + 18, tw - 8, 36), GTextOverflowModeFill, GTextAlignmentLeft, NULL);
    if (tw - bs.w - 10 >= 34) {  // caption only when it fits (narrow screens show the count alone)
      graphics_draw_text(ctx, cap, fonts_get_system_font(FONT_KEY_GOTHIC_14), GRect(x + 8 + bs.w, y + 36, tw - bs.w - 10, 18),
                         GTextOverflowModeFill, GTextAlignmentLeft, NULL);
    }
    if (th >= 78 && rm->thermo && rm->temp >= 0) {
      char t[12];
      snprintf(t, sizeof(t), "%d\xC2\xB0", rm->temp);
      graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(GColorOrange, GColorBlack));
      graphics_fill_circle(ctx, GPoint(x + 11, y + th - 11), 3);
      graphics_draw_text(ctx, t, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(x + 18, y + th - 24, tw - 22, 22),
                         GTextOverflowModeFill, GTextAlignmentLeft, NULL);
    }
  }

  char foot[40];
  int pages = (s_room_count + 3) / 4;
  if (pages > 1) snprintf(foot, sizeof(foot), "Hold DOWN to talk   %d/%d", page + 1, pages);
  else snprintf(foot, sizeof(foot), "Hold DOWN to talk");
  graphics_context_set_text_color(ctx, GColorDarkGray);
  graphics_draw_text(ctx, foot, fonts_get_system_font(FONT_KEY_GOTHIC_14), GRect(0, b.size.h - footer - 1, b.size.w, footer + 2),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);
}

static void grid_up(ClickRecognizerRef r, void *c) {
  if (s_room_count == 0) return;
  s_sel_room = (s_sel_room + s_room_count - 1) % s_room_count;
  layer_mark_dirty(s_grid);
}
static void grid_down(ClickRecognizerRef r, void *c) {
  if (s_room_count == 0) return;
  s_sel_room = (s_sel_room + 1) % s_room_count;
  layer_mark_dirty(s_grid);
}
static void grid_select(ClickRecognizerRef r, void *c) {
  if (s_room_count == 0) {
    send_cmd(CMD_REFRESH, -1, -1);
    return;
  }
  open_room(s_sel_room);
}
static void grid_long_select(ClickRecognizerRef r, void *c) {
  if (s_room_count == 0 || s_rooms[s_sel_room].count == 0) return;
  // Optimistic: if anything is on, turn everything off; otherwise turn everything on.
  int on = room_on_count(s_sel_room);
  for (int i = 0; i < s_rooms[s_sel_room].count; i++) {
    int j = s_rooms[s_sel_room].first + i;
    if (s_lights[j].state != 2) s_lights[j].state = on > 0 ? 0 : 1;
  }
  layer_mark_dirty(s_grid);
  send_cmd(CMD_ROOM_TOGGLE, s_sel_room, -1);
  vibes_short_pulse();
}
static void grid_click_config(void *c) {
  window_single_click_subscribe(BUTTON_ID_UP, grid_up);
  window_single_click_subscribe(BUTTON_ID_DOWN, grid_down);
  window_single_click_subscribe(BUTTON_ID_SELECT, grid_select);
  window_long_click_subscribe(BUTTON_ID_SELECT, LONG_MS, grid_long_select, NULL);
  window_long_click_subscribe(BUTTON_ID_DOWN, LONG_MS, voice_long, NULL);
}

static void main_load(Window *w) {
  Layer *root = window_get_root_layer(w);
  GRect b = layer_get_bounds(root);
  s_main_status = status_bar_layer_create();
  status_bar_layer_set_colors(s_main_status, GColorWhite, GColorBlack);
  layer_add_child(root, status_bar_layer_get_layer(s_main_status));
  s_grid = layer_create(GRect(0, STATUS_BAR_LAYER_HEIGHT, b.size.w, b.size.h - STATUS_BAR_LAYER_HEIGHT));
  layer_set_update_proc(s_grid, grid_draw);
  layer_add_child(root, s_grid);
}
static void main_appear(Window *w) { s_ctx_room = -1; }
static void main_unload(Window *w) {
  layer_destroy(s_grid);
  s_grid = NULL;
  status_bar_layer_destroy(s_main_status);
  s_main_status = NULL;
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

  s_main_window = window_create();
  window_set_background_color(s_main_window, GColorWhite);
  window_set_click_config_provider(s_main_window, grid_click_config);
  window_set_window_handlers(s_main_window, (WindowHandlers){.load = main_load, .appear = main_appear, .unload = main_unload});
  window_stack_push(s_main_window, true);
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
  if (s_room_window) window_destroy(s_room_window);
  window_destroy(s_main_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
