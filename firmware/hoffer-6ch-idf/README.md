# Firmware Hoffer 6 canais (ESP-IDF + ESP RainMaker)

Firmware para a placa de 6 relés com ESP32, controlada pelo app Yassena Home
(ou ESP RainMaker). Cada canal tem o tipo certo (luz, ventilador, tomada,
ar-condicionado ou interruptor), o estado dos relés volta depois de uma queda
de energia e o limite de agendamentos/cenas foi aumentado.

## Antes de compilar

1. Descubra os GPIOs dos relés com o sketch `TesteReles.ino` e ajuste a tabela
   `CHANNELS` em `main/app_main.c` (nome, GPIO e tipo de cada canal).
2. Se os relés funcionarem invertidos, troque `RELAY_ACTIVE_LOW` para `1`.

## Compilar

Requer ESP-IDF 5.x instalado (extensão ESP-IDF do VS Code).

```bash
git clone --recursive https://github.com/espressif/esp-rainmaker.git
cp -r esp-rainmaker/examples/switch esp-rainmaker/examples/hoffer_6ch
cp main/app_main.c main/CMakeLists.txt esp-rainmaker/examples/hoffer_6ch/main/
rm esp-rainmaker/examples/hoffer_6ch/main/app_driver.c esp-rainmaker/examples/hoffer_6ch/main/app_priv.h
cat sdkconfig.defaults.extra >> esp-rainmaker/examples/hoffer_6ch/sdkconfig.defaults
cd esp-rainmaker/examples/hoffer_6ch
idf.py set-target esp32
idf.py build flash monitor
```

No monitor aparece um QR code: leia com o app para conectar a placa ao Wi-Fi
(somente redes 2,4 GHz).

## Botão BOOT (GPIO 0)

- Segurar 3 s: apaga o Wi-Fi (para configurar de novo).
- Segurar 10 s: reset de fábrica (desvincula da conta).

## Ar-condicionado

O relé da placa aguenta ~10 A, mas o pico de partida do compressor desgasta os
contatos. Use o relé apenas para acionar um contator dimensionado para o ar.
