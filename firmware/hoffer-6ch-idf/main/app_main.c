/*
 * Placa Hoffer 6 canais (ESP32) + ESP RainMaker - versão ESP-IDF
 *
 * Cada canal é um dispositivo RainMaker com o tipo certo (luz, ventilador,
 * tomada, ar-condicionado ou interruptor), então o app mostra o ícone correto.
 * O estado de cada relé é salvo pelo RainMaker e restaurado ao religar.
 */

#include <string.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <esp_log.h>
#include <nvs_flash.h>
#include <driver/gpio.h>

#include <esp_rmaker_core.h>
#include <esp_rmaker_standard_types.h>
#include <esp_rmaker_standard_params.h>
#include <esp_rmaker_standard_devices.h>
#include <esp_rmaker_schedule.h>
#include <esp_rmaker_scenes.h>
#include <esp_rmaker_ota.h>
#include <esp_rmaker_console.h>

#include <app_network.h>
#include <app_reset.h>

static const char *TAG = "hoffer6ch";

/* ======================= CONFIGURAÇÃO ======================= */

/* Tipo de cada canal: muda o ícone e o comportamento no app. */
typedef enum {
    CH_SWITCH,      /* interruptor genérico */
    CH_LIGHT,       /* luz */
    CH_FAN,         /* ventilador */
    CH_OUTLET,      /* tomada */
    CH_AC,          /* ar-condicionado (use um contator!) */
} channel_kind_t;

typedef struct {
    const char *name;       /* nome que aparece no app */
    gpio_num_t gpio;        /* GPIO do relé: CONFIRA COM O SKETCH DE TESTE */
    channel_kind_t kind;
} channel_cfg_t;

static const channel_cfg_t CHANNELS[] = {
    {"Luz Sala",       GPIO_NUM_23, CH_LIGHT},
    {"Luz Cozinha",    GPIO_NUM_22, CH_LIGHT},
    {"Luz Quarto",     GPIO_NUM_21, CH_LIGHT},
    {"Ventilador",     GPIO_NUM_19, CH_FAN},
    {"Tomada",         GPIO_NUM_18, CH_OUTLET},
    {"Ar-condicionado", GPIO_NUM_5, CH_AC},
};
#define NUM_CHANNELS (sizeof(CHANNELS) / sizeof(CHANNELS[0]))

/* 1 se o relé liga com nível LOW (comum em placas com optoacoplador). */
#define RELAY_ACTIVE_LOW    0

/* Botão BOOT: 3 s apaga o Wi-Fi, 10 s faz reset de fábrica. */
#define RESET_BUTTON_GPIO           GPIO_NUM_0
#define RESET_BUTTON_ACTIVE_LEVEL   0
#define WIFI_RESET_TIMEOUT_S        3
#define FACTORY_RESET_TIMEOUT_S     10

/* ============================================================ */

static esp_rmaker_device_t *s_devices[NUM_CHANNELS];

static void relay_set(size_t ch, bool on)
{
    gpio_set_level(CHANNELS[ch].gpio, (on ^ RELAY_ACTIVE_LOW) ? 1 : 0);
}

static esp_err_t write_cb(const esp_rmaker_device_t *device,
                          const esp_rmaker_param_t *param,
                          const esp_rmaker_param_val_t val,
                          void *priv_data, esp_rmaker_write_ctx_t *ctx)
{
    size_t ch = (size_t)priv_data;
    if (strcmp(esp_rmaker_param_get_type(param), ESP_RMAKER_PARAM_POWER) == 0) {
        ESP_LOGI(TAG, "%s -> %s (%s)", CHANNELS[ch].name, val.val.b ? "ON" : "OFF",
                 ctx ? esp_rmaker_device_cb_src_to_str(ctx->src) : "?");
        relay_set(ch, val.val.b);
    }
    esp_rmaker_param_update_and_report(param, val);
    return ESP_OK;
}

/* Cria um dispositivo genérico com nome + power (para tipos sem helper pronto). */
static esp_rmaker_device_t *generic_device_create(const char *name, const char *type,
                                                  void *priv, bool power)
{
    esp_rmaker_device_t *dev = esp_rmaker_device_create(name, type, priv);
    esp_rmaker_device_add_param(dev, esp_rmaker_name_param_create(ESP_RMAKER_DEF_NAME_PARAM, name));
    esp_rmaker_param_t *pwr = esp_rmaker_power_param_create(ESP_RMAKER_DEF_POWER_NAME, power);
    esp_rmaker_device_add_param(dev, pwr);
    esp_rmaker_device_assign_primary_param(dev, pwr);
    return dev;
}

static esp_rmaker_device_t *channel_device_create(size_t ch)
{
    const channel_cfg_t *c = &CHANNELS[ch];
    void *priv = (void *)ch;
    switch (c->kind) {
    case CH_LIGHT:
        return generic_device_create(c->name, ESP_RMAKER_DEVICE_LIGHTBULB, priv, false);
    case CH_FAN:
        return generic_device_create(c->name, ESP_RMAKER_DEVICE_FAN, priv, false);
    case CH_OUTLET:
        return generic_device_create(c->name, ESP_RMAKER_DEVICE_OUTLET, priv, false);
    case CH_AC:
        return generic_device_create(c->name, ESP_RMAKER_DEVICE_AIR_CONDITIONER, priv, false);
    default:
        return esp_rmaker_switch_device_create(c->name, priv, false);
    }
}

void app_main(void)
{
    esp_rmaker_console_init();

    for (size_t ch = 0; ch < NUM_CHANNELS; ch++) {
        gpio_reset_pin(CHANNELS[ch].gpio);
        gpio_set_direction(CHANNELS[ch].gpio, GPIO_MODE_OUTPUT);
        relay_set(ch, false);
    }
    app_reset_button_register(
        app_reset_button_create(RESET_BUTTON_GPIO, RESET_BUTTON_ACTIVE_LEVEL),
        WIFI_RESET_TIMEOUT_S, FACTORY_RESET_TIMEOUT_S);

    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);

    app_network_init();

    esp_rmaker_config_t rainmaker_cfg = {
        .enable_time_sync = false,
    };
    esp_rmaker_node_t *node = esp_rmaker_node_init(&rainmaker_cfg, "Hoffer 6 Canais", "Relay Board");
    if (!node) {
        ESP_LOGE(TAG, "Falha ao iniciar o nó RainMaker. Reiniciando...");
        vTaskDelay(pdMS_TO_TICKS(5000));
        abort();
    }

    for (size_t ch = 0; ch < NUM_CHANNELS; ch++) {
        s_devices[ch] = channel_device_create(ch);
        esp_rmaker_device_add_cb(s_devices[ch], write_cb, NULL);
        esp_rmaker_node_add_device(node, s_devices[ch]);

        /* Parâmetros persistentes já vêm com o último valor salvo: aplica no relé. */
        esp_rmaker_param_t *pwr = esp_rmaker_device_get_param_by_type(s_devices[ch], ESP_RMAKER_PARAM_POWER);
        esp_rmaker_param_val_t *saved = pwr ? esp_rmaker_param_get_val(pwr) : NULL;
        if (saved) {
            relay_set(ch, saved->val.b);
        }
    }

    esp_rmaker_ota_enable_default();
    esp_rmaker_timezone_service_enable();
    esp_rmaker_schedule_enable();
    esp_rmaker_scenes_enable();

    esp_rmaker_start();

    err = app_network_start(POP_TYPE_RANDOM);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Falha ao iniciar o Wi-Fi. Reiniciando...");
        vTaskDelay(pdMS_TO_TICKS(5000));
        abort();
    }
}
