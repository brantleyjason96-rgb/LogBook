// Home Lights: list your Google Home lights, toggle them, dim them.
// The phone side (src/pkjs/index.js) talks to the Google Home plugin; see the protocol there.
//
//   SELECT        toggle the highlighted light (first row = all lights off)
//   long SELECT   brightness window: UP / DOWN change it by 10%
#include <pebble.h>

#define MAX_LIGHTS 24
#define NAME_LEN 41
#define ROOM_LEN 25
#define CMD_TOGGLE 1
#define CMD_BRIGHT 2
#define CMD_ALL_OFF 3
#define CMD_REFRESH 4
#define BRIGHT_SEND_DELAY_MS 600

typedef struct {
  char name[NAME_LEN];
  char room[ROOM_LEN];
  int8_t state;   // 0 off, 1 on, 2 offline
  int16_t bright; // 0-100, -1 not dimmable
} Light;

static Window *s_main_window;
static MenuLayer *s_menu;
static Light s_lights[MAX_LIGHTS];
static int s_count = 0;
static char s_status[64] = "Loading lights...";

static Window *s_bright_window;
static TextLayer *s_bright_text;
static int s_bright_idx = -1;
static int s_bright_value = 0;
static char s_bright_buf[80];
static AppTimer *s_bright_timer;

// ---------------------------------------------------------------- phone messages

static void send_cmd(int cmd, int idx, int value) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) return;
  dict_write_int32(iter, MESSAGE_KEY_cmd, cmd);
  if (idx >= 0) dict_write_int32(iter, MESSAGE_KEY_idx, idx);
  if (value >= 0) dict_write_int32(iter, MESSAGE_KEY_value, value);
  app_message_outbox_send();
}

static void inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *status = dict_find(iter, MESSAGE_KEY_status);
  if (status) {
    s_count = 0;
    strncpy(s_status, status->value->cstring, sizeof(s_status) - 1);
    s_status[sizeof(s_status) - 1] = '\0';
    menu_layer_reload_data(s_menu);
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
  if (n > MAX_LIGHTS) n = MAX_LIGHTS;
  s_count = n;
  menu_layer_reload_data(s_menu);
  // The brightness window shows a stale number if a refresh lands under it; that's fine.
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
  static char subtitle[48];
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

// ---------------------------------------------------------------- brightness window

static void bright_refresh_text(void) {
  snprintf(s_bright_buf, sizeof(s_bright_buf), "%s\n\n%d%%\n\nUP / DOWN", s_lights[s_bright_idx].name,
           s_bright_value);
  text_layer_set_text(s_bright_text, s_bright_buf);
}

static void bright_send(void *data) {
  s_bright_timer = NULL;
  send_cmd(CMD_BRIGHT, s_bright_idx, s_bright_value);
}

static void bright_step(int delta) {
  s_bright_value += delta;
  if (s_bright_value < 0) s_bright_value = 0;
  if (s_bright_value > 100) s_bright_value = 100;
  s_lights[s_bright_idx].bright = s_bright_value;
  bright_refresh_text();
  // Wait until the button presses stop before bothering the phone.
  if (s_bright_timer) {
    app_timer_reschedule(s_bright_timer, BRIGHT_SEND_DELAY_MS);
  } else {
    s_bright_timer = app_timer_register(BRIGHT_SEND_DELAY_MS, bright_send, NULL);
  }
}

static void bright_up(ClickRecognizerRef r, void *ctx) { bright_step(10); }
static void bright_down(ClickRecognizerRef r, void *ctx) { bright_step(-10); }

static void bright_click_config(void *ctx) {
  window_single_repeating_click_subscribe(BUTTON_ID_UP, 150, bright_up);
  window_single_repeating_click_subscribe(BUTTON_ID_DOWN, 150, bright_down);
}

static void bright_load(Window *w) {
  Layer *root = window_get_root_layer(w);
  GRect b = layer_get_bounds(root);
  s_bright_text = text_layer_create(GRect(0, b.size.h / 4, b.size.w, b.size.h * 3 / 4));
  text_layer_set_text_alignment(s_bright_text, GTextAlignmentCenter);
  text_layer_set_font(s_bright_text, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD));
  layer_add_child(root, text_layer_get_layer(s_bright_text));
  bright_refresh_text();
}

static void bright_unload(Window *w) {
  if (s_bright_timer) {  // don't lose the last change if the user backs out quickly
    app_timer_cancel(s_bright_timer);
    s_bright_timer = NULL;
    send_cmd(CMD_BRIGHT, s_bright_idx, s_bright_value);
  }
  text_layer_destroy(s_bright_text);
}

static void menu_long_select(MenuLayer *layer, MenuIndex *index, void *ctx) {
  if (s_count == 0 || index->row == 0) return;
  int i = index->row - 1;
  if (s_lights[i].state == 2 || s_lights[i].bright < 0) {
    vibes_short_pulse();  // offline or not dimmable
    return;
  }
  s_bright_idx = i;
  s_bright_value = s_lights[i].bright;
  if (!s_bright_window) {
    s_bright_window = window_create();
    window_set_click_config_provider(s_bright_window, bright_click_config);
    window_set_window_handlers(s_bright_window, (WindowHandlers){.load = bright_load, .unload = bright_unload});
  }
  window_stack_push(s_bright_window, true);
}

// ---------------------------------------------------------------- lifecycle

static void main_load(Window *w) {
  Layer *root = window_get_root_layer(w);
  s_menu = menu_layer_create(layer_get_bounds(root));
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
}

static void init(void) {
  app_message_register_inbox_received(inbox_received);
  app_message_open(256, 64);
  s_main_window = window_create();
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
