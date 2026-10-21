defmodule KfarwellWeb.Router do
  use KfarwellWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {KfarwellWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
    plug KfarwellWeb.Plugs.Visitor
  end

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/", KfarwellWeb do
    pipe_through :browser

    get "/", PageController, :home
    get "/mvdwebcam/privacy", PageController, :mvdwebcam_privacy
    get "/mvdwebcam/privacy.html", PageController, :privacy_html
    get "/multitunnelvpn/privacy", PageController, :multitunnelvpn_privacy
    get "/multitunnelvpn/privacy.html", PageController, :privacy_html
  end

  scope "/api", KfarwellWeb do
    pipe_through :api

    get "/apple-music/token", AppleMusicController, :token
  end
end
