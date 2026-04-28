import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning, module="authlib")
warnings.filterwarnings("ignore", category=UserWarning, module="google.adk")

from app.main import app, run


if __name__ == "__main__":
    run()
