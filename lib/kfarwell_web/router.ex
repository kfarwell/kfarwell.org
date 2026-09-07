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
  end

  scope "/api", KfarwellWeb do
    pipe_through :api

    get "/apple-music/token", AppleMusicController, :token
  end
end
