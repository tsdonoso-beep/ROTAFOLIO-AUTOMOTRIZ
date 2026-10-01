# Carpetas de OC en tu computadora (`pnpm carpetas:local`)

El mismo script que corre cada noche en GitHub (`scripts/carpetas-oc.mts`),
corrido en una computadora. Sirve para la **carga pesada**: abrir y leer por
dentro miles de PDF la primera vez, sin gastar minutos de GitHub y sin
límite de 6 horas.

**Se puede cortar cuando sea.** Lo leído se guarda en la base cada 50
archivos (`lectura_archivo`); al volver a correr el mismo comando sigue
donde quedó y no relee nada. El recorrido de carpetas (nombres) sí se repite
en cada corrida: tarda unos minutos.

**No lo corras al mismo tiempo que la corrida de GitHub** (02:00 a. m.): las
dos reemplazan las mismas tablas.

## 1. Lo que ya tienes (de `pnpm cpe:local`)

El repositorio clonado, `pnpm install` hecho y el `.env.local` con
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ROBOT_CORREO`, `ROBOT_CLAVE`,
`GOOGLE_SA_EMAIL` y `GOOGLE_SA_KEY_FILE` (la clave en `secrets/sa.json`).
Nada más hace falta para recorrer las carpetas y leer los XML y ZIP.

## 2. Para leer PDF y escaneos (una sola vez)

Sin esto el script igual corre: lee XML y ZIP, y deja los PDF e imágenes
para la corrida de GitHub (en el resumen salen como «sin herramienta para
leerlos»).

**Tesseract (el OCR):**

```bash
winget install --id UB-Mannheim.TesseractOCR
```

Después baja el español: `spa.traineddata` desde
<https://github.com/tesseract-ocr/tessdata_fast> y cópialo a
`C:\Program Files\Tesseract-OCR\tessdata\`.

**Poppler (texto de los PDF):** baja el último `Release-…zip` de
<https://github.com/oschwartz10612/poppler-windows/releases> y descomprímelo
en `C:\poppler`.

**Dile al script dónde están** — agrega al `.env.local`:

```
LECTOR_TESSERACT=C:\Program Files\Tesseract-OCR\tesseract.exe
LECTOR_POPPLER=C:\poppler\Library\bin
```

## 3. Los comandos (Git Bash, en la carpeta del repositorio)

```bash
# Prueba: solo mira, no guarda nada (resultado en salida/carpetas-oc/)
PROCEDENCIA=nacional LEER_MAX=200 pnpm carpetas:local

# La carga de verdad, compras nacionales: hasta 2 h de lectura por corrida
DEBUG=0 PROCEDENCIA=nacional LEER_MAX=20000 LEER_MINUTOS=120 LECTORES=6 pnpm carpetas:local

# Importaciones
DEBUG=0 PROCEDENCIA=importacion LEER_MAX=20000 LEER_MINUTOS=120 LECTORES=6 pnpm carpetas:local
```

- `LECTORES`: cuántos archivos a la vez. 6 va bien en una laptop de 4
  núcleos o más; si la computadora se pone lenta, baja a 3.
- `LEER_MINUTOS`: cuánto lee antes de guardar todo y terminar. Si se acaba
  el tiempo, vuelve a correr el mismo comando.
- `SUBCARPETA=TALLERES`: solo ese proyecto (la corrida no reemplaza lo de
  los otros ni anota cambios).
- Deja la computadora sin suspenderse (Windows → Energía → «Nunca»): si se
  suspende, la corrida se congela.

Al terminar, el resumen sale en la pantalla y en
`salida/carpetas-oc/<nacionales|importaciones>/resumen.md`, con los CSV de
detalle al lado. La hoja «OC - CARPETAS …» se publica igual que desde GitHub.
