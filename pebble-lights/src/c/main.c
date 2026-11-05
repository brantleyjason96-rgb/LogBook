// Home Lights: list your Google Home lights, toggle them, dim them.
// The phone side (src/pkjs/index.js) talks to the Google Home plugin; protocol is described there.
//
//   Main list     SELECT toggles the highlighted light (first row = all lights off)
//                 long SELECT opens the brightness window
//   Brightness    UP/DOWN change by 10% (hold to repeat), SELECT applies now, BACK applies and leaves
#include <pebble.h>

#define MAX_LIGHTS 24
#define NAME_LEN 41
#define ROOM_LEN 25
#define CMD_TOGGLE 1
#define CMD_BRIGHT 2
#define CMD_ALL_OFF 3
#define CMD_REFRESH 4
#define BRIGHT_STEP 10
#define BRIGHT_REPEAT_MS 150
#define BRIGHT_SEND_DELAY_MS 600

typedef struct {
  char name[NAME_LEN];
  char room[ROOM_LEN];
  int8_t state;    // 0 off, 1 on, 2 offline
  int16_t bright;  // 0-100, -1 not dimmable
} Light;

// ---- main window
static Window *s_main_window;
static StatusBarLayer *s_main_status;
static MenuLayer *s_menu;
static Light s_lights[MAX_LIGHTS];
static int s_count = 0;
static char s_status[64] = "Loading lights...";

// ---- brightness window
static Window *s_bright_window;
static StatusBarLayer *s_bright_status;
static Layer *s_bright_layer;
static int s_bright_idx = -1;
static int s_bright_value = 0;
static AppTimer *s_bright_timer;

// ---------------------------------------------------------------- phone messages

static void send_cmd(int cmd, int idx, int value) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    vibes_short_pulse();  // phone link busy or down: tell the user the press didn't go through
    return;
  }
  dict_write_int32(iter, MESSAGE_KEY_cmd, cmd);
  if (idx >= 0) dict_write_int32(iter, MESSAGE_KEY_idx, idx);
  if (value >= 0) dict_write_int32(iter, MESSAGE_KEY_value, value);
  app_message_outbox_send();
}

static void outbox_failed(DictionaryIterator *iter, AppMessageResult reason, void *ctx) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "send failed: %d", (int)reason);
  vibes_short_pulse();
}

static void inbox_received(DictionaryIterator *iter, void *ctx) {
  Tuple *status = dict_find(iter, MESSAGE_KEY_status);
  if (status) {
    s_count = 0;
    strncpy(s_status, status->value->cstring, sizeof(s_status) - 1);
    s_status[sizeof(s_status) - 1] = '\0';
    if (s_menu) menu_layer_reload_data(s_menu);
    return;
  }

  Tuple *total = dict_find(iter, MESSAGE_KEY_total);
  Tuple *idx = dict_find(iter, MESSAGE_KEY_idx);
  Tuple *name = dict_find(iter, MESSAGE_KEY_name);
  if (!total || !idx || !name) return;

  int i = idx->value->int32;
  if (i < 0 || i >= MAX_LIGHTS) return;
  Light *l = &s_lights[i];
  strncpy(l->name, name->value->cstring, NAME_LEN - 1);
  l->name[NAME_LEN - 1] = '\0';
  Tuple *room = dict_find(iter, MESSAGE_KEY_room);
  strncpy(l->room, room ? room->value->cstring : "", ROOM_LEN - 1);
  l->room[ROOM_LEN - 1] = '\0';
  Tuple *state = dict_find(iter, MESSAGE_KEY_state);
  l->state = state ? (int8_t)state->value->int32 : 0;
  Tuple *bright = dict_find(iter, MESSAGE_KEY_bright);
  l->bright = bright ? (int16_t)bright->value->int32 : -1;

  int n = total->value->int32;
  s_count = n > MAX_LIGHTS ? MAX_LIGHTS : n;
  if (s_menu) menu_layer_reload_data(s_menu);

  // Keep the brightness window honest if the phone reports a change, unless the user is mid-edit.
  if (s_bright_layer && i == s_bright_idx && !s_bright_timer && l->bright >= 0) {
    s_bright_value = l->bright;
    layer_mark_dirty(s_bright_layer);
  }
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
  int v = s_bright_value + delta;
  if (v < 0) v = 0;
  if (v > 100) v = 100;
  if (v == s_bright_value) return;
  s_bright_value = v;
  s_lights[s_bright_idx].bright = v;
  layer_mark_dirty(s_bright_layer);
  // Wait until the button presses stop before bothering the phone.
  if (s_bright_timer) {
    app_timer_reschedule(s_bright_timer, BRIGHT_SEND_DELAY_MS);
  } else {
    s_bright_timer = app_timer_register(BRIGHT_SEND_DELAY_MS, bright_timer_fired, NULL);
  }
}

static void bright_up(ClickRecognizerRef r, void *ctx) { bright_step(BRIGHT_STEP); }
static void bright_down(ClickRecognizerRef r, void *ctx) { bright_step(-BRIGHT_STEP); }
static void bright_select(ClickRecognizerRef r, void *ctx) {
  bright_flush();
  window_stack_pop(true);
}

static void bright_click_config(void *ctx) {
  window_single_repeating_click_subscribe(BUTTON_ID_UP, BRIGHT_REPEAT_MS, bright_up);
  window_single_repeating_click_subscribe(BUTTON_ID_DOWN, BRIGHT_REPEAT_MS, bright_down);
  window_single_click_subscribe(BUTTON_ID_SELECT, bright_select);
}

// Layout (content area is the window below the status bar, so h = screen height - 16):
//   name     y = 4 .. 32      (GOTHIC_24_BOLD, inset on round so the corners don't clip it)
//   percent  y = h/2-28 .. +50 (BITHAM_42_BOLD)
//   bar      y = h-32 .. h-20  (12 px tall, inset from the sides)
// On basalt (h = 152): name 4-32, percent 48-98, bar 120-132. On emery (h = 212): 4-32, 78-128, 180-192.
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
  graphics_draw_text(ctx, pct, fonts_get_system_font(FONT_KEY_BITHAM_42_BOLD),
                     GRect(0, b.size.h / 2 - 28, b.size.w, 50), GTextOverflowModeFill, GTextAlignmentCenter, NULL);

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
  // Don't lose the last change if the user backs out before the delay elapses.
  if (s_bright_timer) bright_flush();
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
      .load = bright_load, .disappear = bright_disappear, .unload = bright_unload,
    });
  }
  window_stack_push(s_bright_window, true);
}

// ---------------------------------------------------------------- main menu

static uint16_t menu_rows(MenuLayer *layer, uint16_t section, void *ctx) {
  return s_count == 0 ? 1 : s_count + 1;  // +1 for "All lights off"
}

static void menu_draw_row(GContext *gctx, const Layer *cell, MenuIndex *index, void *ctx) {
  if (s_count == 0) {
    menu_cell_basic_draw(gctx, cell, s_status, "Select to retry", NULL);
    return;
  }
  if (index->row == 0) {
    menu_cell_basic_draw(gctx, cell, "All lights off", NULL, NULL);
    return;
  }
  const Light *l = &s_lights[index->row - 1];
  char subtitle[48];
  if (l->state == 2) {
    snprintf(subtitle, sizeof(subtitle), "Offline");
  } else if (l->state == 1 && l->bright >= 0) {
    snprintf(subtitle, sizeof(subtitle), "On %d%% - %s", l->bright, l->room);
  } else {
    snprintf(subtitle, sizeof(subtitle), "%s - %s", l->state == 1 ? "On" : "Off", l->room);
  }
  menu_cell_basic_draw(gctx, cell, l->name, subtitle, NULL);
}

static void menu_select(MenuLayer *layer, MenuIndex *index, void *ctx) {
  if (s_count == 0) {
    send_cmd(CMD_REFRESH, -1, -1);
    return;
  }
  if (index->row == 0) {
    send_cmd(CMD_ALL_OFF, -1, -1);
    vibes_short_pulse();
    return;
  }
  int i = index->row - 1;
  // Show the change straight away; the phone confirms with a fresh row.
  if (s_lights[i].state != 2) {
    s_lights[i].state = s_lights[i].state == 1 ? 0 : 1;
    layer_mark_dirty(menu_layer_get_layer(s_menu));
  }
  send_cmd(CMD_TOGGLE, i, -1);
}

static void menu_long_select(MenuLayer *layer, MenuIndex *index, void *ctx) {
  if (s_count == 0 || index->row == 0) return;
  int i = index->row - 1;
  if (s_lights[i].state == 2 || s_lights[i].bright < 0) {
    vibes_short_pulse();  // offline or not dimmable
    return;
  }
  open_brightness(i);
}

static void main_load(Window *w) {
  Layer *root = window_get_root_layer(w);
  GRect b = layer_get_bounds(root);
  s_main_status = status_bar_layer_create();
  status_bar_layer_set_colors(s_main_status, GColorWhite, GColorBlack);
  layer_add_child(root, status_bar_layer_get_layer(s_main_status));

  s_menu = menu_layer_create(GRect(0, STATUS_BAR_LAYER_HEIGHT, b.size.w, b.size.h - STATUS_BAR_LAYER_HEIGHT));
  menu_layer_set_callbacks(s_menu, NULL, (MenuLayerCallbacks){
    .get_num_rows = menu_rows,
    .draw_row = menu_draw_row,
    .select_click = menu_select,
    .select_long_click = menu_long_select,
  });
  menu_layer_set_click_config_onto_window(s_menu, w);
  layer_add_child(root, menu_layer_get_layer(s_menu));
}

static void main_unload(Window *w) {
  menu_layer_destroy(s_menu);
  s_menu = NULL;
  status_bar_layer_destroy(s_main_status);
  s_main_status = NULL;
}

// ---------------------------------------------------------------- lifecycle

static void init(void) {
  // Callbacks first, then open (inbox holds one light row; outbox one command).
  app_message_register_inbox_received(inbox_received);
  app_message_register_outbox_failed(outbox_failed);
  app_message_open(256, 64);

  s_main_window = window_create();
  window_set_background_color(s_main_window, GColorWhite);
  window_set_window_handlers(s_main_window, (WindowHandlers){.load = main_load, .unload = main_unload});
  window_stack_push(s_main_window, true);
}

static void deinit(void) {
  if (s_bright_window) window_destroy(s_bright_window);
  window_destroy(s_main_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
