defmodule KfarwellWeb.PageController do
  use KfarwellWeb, :controller

  def home(conn, _params) do
    render(conn, :home)
  end
end
