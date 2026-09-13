#!/usr/bin/env python3
"""Regenera lib/sunat/__tests__/zip.fixtures.ts

Los zips de prueba se hacen con herramientas ajenas al código que los lee
(`zip` del sistema y `zipfile` de Python). Si el lector y el escritor fueran
nuestros, la prueba solo diría que los dos cometen el mismo error.

    python3 db/carga/zips-de-prueba.py

Requiere `zip` en el PATH. Reescribe el archivo de fixtures en su sitio.
"""
import base64
import os
import subprocess
import sys
import tempfile
import textwrap
import zipfile

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DESTINO = os.path.join(RAIZ, "lib", "sunat", "__tests__", "zip.fixtures.ts")


class NoSeek:
    """Un destino que no se puede rebobinar.

    Obliga a zipfile a usar descriptor de datos (bit 3 de la bandera): la
    cabecera local queda con tamaño 0 y los tamaños reales se escriben
    detrás del contenido.
    """

    def __init__(self, f):
        self.f = f
        self.n = 0

    def write(self, b):
        self.n += len(b)
        return self.f.write(b)

    def flush(self):
        self.f.flush()

    def tell(self):
        return self.n

    def seekable(self):
        return False


def contenido_csv() -> bytes:
    lineas = ["periodo;ruc;razón social;monto"]
    lineas += [f"202608;20512201611;PROVEEDOR DE PRUEBA Ñ {i};{i}.50" for i in range(500)]
    return ("\n".join(lineas) + "\n").encode("utf-8")


def construir(tmp: str) -> dict:
    csv = contenido_csv()
    os.makedirs(os.path.join(tmp, "src", "sub"), exist_ok=True)
    with open(os.path.join(tmp, "src", "reporte.csv"), "wb") as f:
        f.write(csv)
    with open(os.path.join(tmp, "src", "sub", "nota.txt"), "w", encoding="utf-8") as f:
        f.write("hola")

    deflate = os.path.join(tmp, "deflate.zip")
    stored = os.path.join(tmp, "stored.zip")
    descriptor = os.path.join(tmp, "descriptor.zip")

    subprocess.run(["zip", "-q", "-r", deflate, "."], cwd=os.path.join(tmp, "src"), check=True)
    subprocess.run(["zip", "-q", "-0", stored, "sub/nota.txt"], cwd=os.path.join(tmp, "src"), check=True)

    with open(descriptor, "wb") as raw:
        with zipfile.ZipFile(NoSeek(raw), "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("reporte.csv", csv)

    return {"deflate": deflate, "stored": stored, "descriptor": descriptor}


def envolver(b64: str) -> str:
    return "\n".join('  "%s" +' % l for l in textwrap.wrap(b64, 76))[:-2]


NOTAS = [
    ("DEFLATE", "deflate", "Dos archivos, uno en subcarpeta. El caso normal."),
    ("SIN_COMPRIMIR", "stored", "Método 0: el contenido va tal cual."),
    (
        "CON_DESCRIPTOR",
        "descriptor",
        "Escrito sobre un destino que no se puede rebobinar: la cabecera local\n"
        "// declara tamaño 0 y los tamaños reales van detrás del contenido. Es el\n"
        "// caso que rompe a quien recorre el archivo de principio a fin.",
    ),
]


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        rutas = construir(tmp)
        partes = [
            "// Zips de verdad, hechos con `zip` y con `zipfile` de Python, no por el",
            "// mismo código que los lee. Probar un lector contra un escritor propio solo",
            "// confirma que el error es consistente en los dos lados.",
            "//",
            "// Se regeneran con db/carga/zips-de-prueba.py si alguna vez hace falta.",
            "",
        ]
        for nombre, clave, nota in NOTAS:
            with open(rutas[clave], "rb") as f:
                b64 = base64.b64encode(f.read()).decode()
            partes += [f"/** {nota} */", f"export const {nombre} =", envolver(b64) + ";", ""]

        with open(DESTINO, "w", encoding="utf-8") as f:
            f.write("\n".join(partes))

    print(f"escrito {DESTINO}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
