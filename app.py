import os
from flask import Flask, render_template

app = Flask(__name__)

# Relê os templates quando o arquivo muda. Sem isso o Flask (fora do modo debug) guarda o
# HTML em memória até reiniciar, e um template antigo acaba servido com CSS e JS novos.
app.config["TEMPLATES_AUTO_RELOAD"] = True


@app.route("/")
def index():
    """Página inicial: apresenta o projeto e leva ao simulador."""
    return render_template("index.html")


@app.route("/simulador")
def simulador():
    """O simulador 3D (aceita parâmetros como ?modo=grid&n=150&paineis=1)."""
    return render_template("simulador.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    if os.environ.get("FLASK_DEBUG") == "1":
        # Servidor de desenvolvimento com o debugger do Werkzeug, só quando pedido
        app.run(debug=True, port=port)
    else:
        # Servidor WSGI de produção (o app.run do Flask não serve para isso)
        from waitress import serve
        print(f"Servindo em http://127.0.0.1:{port}")
        serve(app, host=os.environ.get("HOST", "127.0.0.1"), port=port)
