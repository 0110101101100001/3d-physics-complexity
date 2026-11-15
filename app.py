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
    # Debugger do Werkzeug só quando pedido explicitamente (FLASK_DEBUG=1)
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1")
